import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { OutboxService } from '@rcn/events';
import {
  DeliveryPriority,
  EVENT_VERSIONS,
  EXCHANGES,
  OrderCancelledEvent,
  OrderCreatedEvent,
  OrderStatus,
  OrderStatusUpdatedEvent,
  ROUTING_KEYS,
} from '@rcn/types';
import { OrderEntity } from './order.entity';
import { CreateOrderDto } from './order.dto';
import { canTransition } from './order.status';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
  ) {}

  async create(customerId: string, dto: CreateOrderDto) {
    const order = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderEntity);
      const saved = await repo.save(
        repo.create({
          orderNumber: `ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
            .toString('hex')
            .toUpperCase()}`,
          customerId,
          status: OrderStatus.PENDING,
          priority: dto.priority ?? DeliveryPriority.NORMAL,
          pickupLat: dto.pickupLat,
          pickupLng: dto.pickupLng,
          dropoffLat: dto.dropoffLat,
          dropoffLng: dto.dropoffLng,
        }),
      );

      await this.outbox.storeEvent(manager, {
        exchange: EXCHANGES.ORDER_EVENTS,
        routingKey: ROUTING_KEYS.ORDER_CREATED,
        payload: {
          version: EVENT_VERSIONS.ORDER_CREATED,
          type: 'order.created',
          timestamp: new Date().toISOString(),
          orderId: saved.id,
          customerId,
          pickupLat: saved.pickupLat,
          pickupLng: saved.pickupLng,
          dropoffLat: saved.dropoffLat,
          dropoffLng: saved.dropoffLng,
          priority: saved.priority,
        } satisfies OrderCreatedEvent,
      });
      return saved;
    });

    this.logger.log(`Order ${order.orderNumber} created`);
    return this.toResponse(order);
  }

  async projectDispatchOutcome(
    orderId: string,
    outcome:
      | { status: OrderStatus.ASSIGNED; courierId: string }
      | { status: OrderStatus.DISPATCH_FAILED },
  ): Promise<void> {
    const res = await this.orders.update(
      { id: orderId, status: OrderStatus.PENDING },
      outcome,
    );
    if (res.affected) this.logger.log(`Order ${orderId} projected → ${outcome.status}`);
  }

  async updateStatus(id: string, newStatus: OrderStatus, userId: string, role: string) {
    if (role === 'customer') {
      throw new ForbiddenException('Only the assigned courier can advance an order');
    }
    const updated = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, id, userId, role);
      if (!canTransition(order.status, newStatus)) {
        throw new BadRequestException(`Cannot transition ${order.status} → ${newStatus}`);
      }

      const previousStatus = order.status;
      order.status = newStatus;
      const saved = await manager.getRepository(OrderEntity).save(order);
      await this.outbox.storeEvent(manager, {
        exchange: EXCHANGES.ORDER_EVENTS,
        routingKey: ROUTING_KEYS.ORDER_STATUS_UPDATED,
        payload: {
          version: EVENT_VERSIONS.ORDER_STATUS_UPDATED,
          type: 'order.status.updated',
          timestamp: new Date().toISOString(),
          orderId: id,
          previousStatus,
          newStatus,
          courierId: saved.courierId ?? undefined,
        } satisfies OrderStatusUpdatedEvent,
      });
      return saved;
    });
    return this.toResponse(updated);
  }

  async cancel(id: string, reason: string, userId: string, role: string) {
    const updated = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, id, userId, role);
      if (!canTransition(order.status, OrderStatus.CANCELLED)) {
        throw new BadRequestException(`Cannot cancel an order in ${order.status}`);
      }
      order.status = OrderStatus.CANCELLED;
      order.cancelReason = reason;
      const saved = await manager.getRepository(OrderEntity).save(order);
      await this.outbox.storeEvent(manager, {
        exchange: EXCHANGES.ORDER_EVENTS,
        routingKey: ROUTING_KEYS.ORDER_CANCELLED,
        payload: {
          version: EVENT_VERSIONS.ORDER_CANCELLED,
          type: 'order.cancelled',
          timestamp: new Date().toISOString(),
          orderId: id,
          courierId: saved.courierId ?? undefined,
          reason,
        } satisfies OrderCancelledEvent,
      });
      return saved;
    });
    return this.toResponse(updated);
  }

  async list(userId: string, role: string) {
    const where =
      role === 'customer'
        ? { customerId: userId }
        : role === 'courier'
          ? { courierId: userId }
          : {};
    const rows = await this.orders.find({ where, order: { createdAt: 'DESC' }, take: 50 });
    return rows.map((o) => this.toResponse(o));
  }

  async getById(id: string, userId: string, role: string) {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    this.assertParty(order, userId, role);
    return this.toResponse(order);
  }

  private async lockOrder(manager: EntityManager, id: string, userId: string, role: string) {
    const order = await manager.findOne(OrderEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) throw new NotFoundException('Order not found');
    this.assertParty(order, userId, role);
    return order;
  }

  private assertParty(order: OrderEntity, userId: string, role: string): void {
    const denied =
      (role === 'customer' && order.customerId !== userId) ||
      (role === 'courier' && order.courierId !== userId);
    if (denied) throw new ForbiddenException('Not your order');
  }

  private toResponse(o: OrderEntity) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      customerId: o.customerId,
      courierId: o.courierId ?? undefined,
      status: o.status,
      priority: o.priority,
      pickupLat: o.pickupLat,
      pickupLng: o.pickupLng,
      dropoffLat: o.dropoffLat,
      dropoffLng: o.dropoffLng,
      createdAt: o.createdAt,
    };
  }
}
