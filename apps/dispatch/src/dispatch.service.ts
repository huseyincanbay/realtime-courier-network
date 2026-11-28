import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { OutboxService } from '@rcn/events';
import {
  EVENT_VERSIONS,
  EXCHANGES,
  OrderAssignedEvent,
  OrderDispatchFailedEvent,
  ROUTING_KEYS,
} from '@rcn/types';
import { DispatchLogEntity } from './dispatch-log.entity';
import { LocationGrpcClient, NearbyCourier } from './location-grpc.client';
import { RedisLockService } from './redis-lock.service';

export interface OrderPayload {
  orderId: string;
  customerId: string;
  pickupLat: number;
  pickupLng: number;
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string }).code === UNIQUE_VIOLATION
  );
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly location: LocationGrpcClient,
    private readonly lock: RedisLockService,
    private readonly config: ConfigService,
  ) {}

  async handleOrderCreated(payload: OrderPayload): Promise<void> {
    await this.attemptDispatch(payload, 1);
  }

  async attemptDispatch(payload: OrderPayload, attemptNumber: number): Promise<void> {
    if (await this.alreadyHandled(payload.orderId, attemptNumber)) {
      this.logger.debug(`Order ${payload.orderId} attempt ${attemptNumber} already handled`);
      return;
    }
    try {
      await this.decide(payload, attemptNumber);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      this.logger.log(
        `Order ${payload.orderId} attempt ${attemptNumber} was recorded by another worker — dropped`,
      );
    }
  }

  private async decide(payload: OrderPayload, attemptNumber: number): Promise<void> {
    const cfg = this.config.get('app');
    const radius = Math.min(
      cfg.baseRadiusM * Math.pow(1.5, attemptNumber - 1),
      cfg.maxRadiusM,
    );
    const candidates = await this.location.getNearby(
      payload.pickupLat,
      payload.pickupLng,
      Math.round(radius),
      cfg.candidateLimit,
    );

    for (const c of candidates) {
      if (!(await this.lock.isOnline(c.courierId))) continue;
      if (!(await this.lock.acquireCourier(c.courierId, payload.orderId))) continue;
      try {
        await this.assign(payload.orderId, c, attemptNumber, candidates.length);
      } catch (err) {
        await this.lock.releaseCourier(c.courierId, payload.orderId);
        throw err;
      }
      return;
    }

    if (attemptNumber < cfg.maxAttempts) {
      await this.retryLater(payload, attemptNumber, candidates.length);
    } else {
      await this.fail(payload.orderId, attemptNumber, candidates.length);
    }
  }

  async release(orderId: string, status: 'cancelled' | 'delivered'): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT courier_id FROM dispatch.dispatch_logs
       WHERE order_id = $1 AND status = 'assigned'
       ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    if (row?.courier_id) await this.lock.releaseCourier(row.courier_id, orderId);
    await this.log(orderId, status, row?.courier_id ?? null, null, 0, 0);
    this.logger.log(
      `Order ${orderId} ${status} — ${row?.courier_id ? 'courier released' : 'no courier held'}`,
    );
  }

  private async alreadyHandled(orderId: string, attemptNumber: number): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM dispatch.dispatch_logs
       WHERE order_id = $1 AND (status = 'cancelled' OR attempt_number >= $2)
       LIMIT 1`,
      [orderId, attemptNumber],
    );
    return rows.length > 0;
  }

  private async assign(
    orderId: string,
    courier: NearbyCourier,
    attemptNumber: number,
    found: number,
  ): Promise<void> {
    const etaMinutes = Math.max(1, Math.round((courier.distanceM / 1000 / 30) * 60));
    await this.dataSource.transaction(async (manager) => {
      await this.log(
        orderId,
        'assigned',
        courier.courierId,
        courier.distanceM,
        attemptNumber,
        found,
        manager,
      );
      await this.outbox.storeEvent(manager, {
        exchange: EXCHANGES.ORDER_EVENTS,
        routingKey: ROUTING_KEYS.ORDER_ASSIGNED,
        payload: {
          version: EVENT_VERSIONS.ORDER_ASSIGNED,
          type: 'order.assigned',
          timestamp: new Date().toISOString(),
          orderId,
          courierId: courier.courierId,
          etaMinutes,
        } satisfies OrderAssignedEvent,
      });
    });
    this.logger.log(
      `Order ${orderId} → courier ${courier.courierId.slice(0, 8)} ` +
        `(${Math.round(courier.distanceM)}m, eta ${etaMinutes}min)`,
    );
  }

  private async fail(orderId: string, attempts: number, found: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.log(orderId, 'failed', null, null, attempts, found, manager);
      await this.outbox.storeEvent(manager, {
        exchange: EXCHANGES.ORDER_EVENTS,
        routingKey: ROUTING_KEYS.ORDER_DISPATCH_FAILED,
        payload: {
          version: EVENT_VERSIONS.ORDER_DISPATCH_FAILED,
          type: 'order.dispatch.failed',
          timestamp: new Date().toISOString(),
          orderId,
          attempts,
        } satisfies OrderDispatchFailedEvent,
      });
    });
    this.logger.warn(`Order ${orderId} failed after ${attempts} attempts`);
  }

  private async retryLater(
    payload: OrderPayload,
    attemptNumber: number,
    found: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.log(payload.orderId, 'no_courier', null, null, attemptNumber, found, manager);
      await this.outbox.storeEvent(manager, {
        exchange: EXCHANGES.DISPATCH_RETRY,
        routingKey: ROUTING_KEYS.DISPATCH_RETRY,
        payload: { type: 'dispatch.retry', payload, attemptNumber: attemptNumber + 1 },
      });
    });
    this.logger.log(
      `Order ${payload.orderId} no courier — retry ${attemptNumber + 1} scheduled (30s)`,
    );
  }

  private async log(
    orderId: string,
    status: string,
    courierId: string | null,
    distanceM: number | null,
    attemptNumber: number,
    found: number,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    const repo = manager.getRepository(DispatchLogEntity);
    await repo.save(
      repo.create({ orderId, status, courierId, distanceM, attemptNumber, couriersFound: found }),
    );
  }
}
