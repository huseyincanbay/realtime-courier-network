import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { OutboxService, RabbitMQService } from '@rcn/events';
import { EVENT_VERSIONS, EXCHANGES, ROUTING_KEYS } from '@rcn/types';
import { DispatchLogEntity } from './dispatch-log.entity';
import { LocationGrpcClient, NearbyCourier } from './location-grpc.client';
import { RedisLockService } from './redis-lock.service';

export interface OrderPayload {
  orderId: string;
  customerId: string;
  pickupLat: number;
  pickupLng: number;
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly rabbit: RabbitMQService,
    private readonly location: LocationGrpcClient,
    private readonly lock: RedisLockService,
    private readonly config: ConfigService,
  ) {}

  async handleOrderCreated(payload: OrderPayload): Promise<void> {
    await this.attemptDispatch(payload, 1);
  }

  async attemptDispatch(payload: OrderPayload, attemptNumber: number): Promise<void> {
    const cfg = this.config.get('app');
    const radius = Math.min(
      cfg.baseRadiusM * Math.pow(1.5, attemptNumber - 1),
      cfg.maxRadiusM,
    );
    const candidates = await this.location.getNearby(
      payload.pickupLat,
      payload.pickupLng,
      Math.round(radius),
      10,
    );

    for (const c of candidates) {
      if (!(await this.lock.isOnline(c.courierId))) continue;
      if (!(await this.lock.acquireCourier(c.courierId, payload.orderId))) continue;
      await this.assign(payload.orderId, c, attemptNumber, candidates.length);
      return;
    }

    if (attemptNumber < cfg.maxAttempts) {
      await this.scheduleRetry(payload, attemptNumber);
      await this.log(payload.orderId, 'no_courier', null, null, attemptNumber, candidates.length);
    } else {
      await this.log(payload.orderId, 'failed', null, null, attemptNumber, candidates.length);
      this.logger.warn(`Order ${payload.orderId} failed after ${attemptNumber} attempts`);
    }
  }

  async handleCancelled(orderId: string): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT courier_id FROM dispatch.dispatch_logs
       WHERE order_id = $1 AND status = 'assigned'
       ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    if (row?.courier_id) {
      await this.lock.releaseCourier(row.courier_id, orderId);
      this.logger.log(`Order ${orderId} cancelled — courier released`);
    }
  }

  private async assign(
    orderId: string,
    courier: NearbyCourier,
    attemptNumber: number,
    found: number,
  ): Promise<void> {
    const etaMinutes = Math.max(1, Math.round((courier.distanceM / 1000 / 30) * 60));
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(DispatchLogEntity);
      await repo.save(
        repo.create({
          orderId,
          status: 'assigned',
          courierId: courier.courierId,
          distanceM: courier.distanceM,
          attemptNumber,
          couriersFound: found,
        }),
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
        },
      });
    });
    this.logger.log(
      `Order ${orderId} → courier ${courier.courierId.slice(0, 8)} ` +
        `(${Math.round(courier.distanceM)}m, eta ${etaMinutes}min)`,
    );
  }

  private async scheduleRetry(payload: OrderPayload, attemptNumber: number): Promise<void> {
    await this.rabbit.publish(
      { exchange: EXCHANGES.DISPATCH_RETRY, routingKey: ROUTING_KEYS.DISPATCH_RETRY },
      { type: 'dispatch.retry', payload, attemptNumber: attemptNumber + 1 },
    );
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
  ): Promise<void> {
    const repo = this.dataSource.getRepository(DispatchLogEntity);
    await repo.save(
      repo.create({ orderId, status, courierId, distanceM, attemptNumber, couriersFound: found }),
    );
  }
}
