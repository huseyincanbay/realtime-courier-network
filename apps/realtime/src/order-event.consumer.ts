import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '@rcn/events';
import { QUEUES } from '@rcn/types';
import { TrackingGateway } from './tracking.gateway';
import { RedisService } from './redis.service';

@Injectable()
export class OrderEventConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderEventConsumer.name);

  constructor(
    private readonly rabbit: RabbitMQService,
    private readonly gateway: TrackingGateway,
    private readonly membership: RedisService,
  ) {}

  async onModuleInit() {
    await this.rabbit.consume(
      { queue: QUEUES.REALTIME, prefetch: 20 },
      async (msg, ack, nack) => {
        try {
          await this.handle(msg);
          ack();
        } catch (err) {
          this.logger.error(`Failed: ${(err as Error).message}`);
          nack(false);
        }
      },
    );
  }

  private async handle(msg: Record<string, unknown>): Promise<void> {
    const orderId = msg.orderId as string;
    switch (msg.type) {
      case 'order.created':
        await this.membership.rememberCustomer(orderId, msg.customerId as string);
        this.gateway.emitToUser(msg.customerId as string, 'order:created', {
          orderId,
          status: 'pending',
        });
        break;
      case 'order.assigned':
        await this.membership.rememberCourier(orderId, msg.courierId as string);
        this.gateway.emitToOrder(orderId, 'order:assigned', {
          orderId,
          courierId: msg.courierId,
          etaMinutes: msg.etaMinutes,
        });
        break;
      case 'order.status.updated':
        this.gateway.emitToOrder(orderId, 'order:status', {
          orderId,
          newStatus: msg.newStatus,
        });
        break;
      case 'order.cancelled':
        this.gateway.emitToOrder(orderId, 'order:cancelled', { orderId });
        break;
    }
  }
}
