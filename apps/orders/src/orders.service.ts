import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OutboxService } from '@rcn/events';
import {
  DeliveryPriority,
  EVENT_VERSIONS,
  EXCHANGES,
  OrderStatus,
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
          orderNumber: `ORD-${Date.now().toString(36).toUpperCase()}`,
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
        },
      });
      return saved;
    });

    this.logger.log(`Order ${order.orderNumber} created`);
    return this.toResponse(order);
  }

  async markAssignedFromDispatch(orderId: string, courierId: string): Promise<void> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) return;
    if (order.status === OrderStatus.ASSIGNED && order.courierId === courierId) return;
    if (
      order.status === OrderStatus.PICKED_UP ||
      order.status === OrderStatus.IN_TRANSIT ||
      order.status === OrderStatus.DELIVERED ||
      order.status === OrderStatus.CANCELLED
    ) {
      return;
    }
    order.courierId = courierId;
    order.status = OrderStatus.ASSIGNED;
    await this.orders.save(order);
    this.logger.log(`Order ${orderId} projected → assigned (courier ${courierId.slice(0, 8)})`);
  }

  async updateStatus(id: string, newStatus: OrderStatus, userId: string, role: string) {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (role === 'customer' && order.customerId !== userId) {
      throw new ForbiddenException('You can only update your own orders');
    }
    if (role === 'courier' && order.courierId !== userId) {
      throw new ForbiddenException('You can only update orders assigned to you');
    }
    if (!canTransition(order.status, newStatus)) {
      throw new BadRequestException(`Cannot transition ${order.status} → ${newStatus}`);
    }

    const updated = await this.dataSource.transaction(async (manager) => {
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
        },
      });
      return saved;
    });
    return this.toResponse(updated);
  }

  async cancel(id: string, reason: string, userId: string, role: string) {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (role === 'customer' && order.customerId !== userId) {
      throw new ForbiddenException('You can only cancel your own orders');
    }
    if (!canTransition(order.status, OrderStatus.CANCELLED)) {
      throw new BadRequestException(`Cannot cancel an order in ${order.status}`);
    }

    const updated = await this.dataSource.transaction(async (manager) => {
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
        },
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
    if (role === 'customer' && order.customerId !== userId) throw new ForbiddenException();
    if (role === 'courier' && order.courierId !== userId) throw new ForbiddenException();
    return this.toResponse(order);
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
