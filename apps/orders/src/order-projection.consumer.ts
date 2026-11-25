import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '@rcn/events';
import { OrderStatus, QUEUES } from '@rcn/types';
import { OrdersService } from './orders.service';

@Injectable()
export class OrderProjectionConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderProjectionConsumer.name);

  constructor(
    private readonly rabbit: RabbitMQService,
    private readonly orders: OrdersService,
  ) {}

  async onModuleInit() {
    await this.rabbit.consume(
      { queue: QUEUES.ORDER_PROJECTION, prefetch: 10 },
      async (msg, ack, nack) => {
        try {
          const orderId = msg.orderId as string;
          if (msg.type === 'order.assigned') {
            await this.orders.projectDispatchOutcome(orderId, {
              status: OrderStatus.ASSIGNED,
              courierId: msg.courierId as string,
            });
          } else if (msg.type === 'order.dispatch.failed') {
            await this.orders.projectDispatchOutcome(orderId, {
              status: OrderStatus.DISPATCH_FAILED,
            });
          }
          ack();
        } catch (err) {
          this.logger.error(`Projection failed: ${(err as Error).message}`);
          nack(false);
        }
      },
    );
  }
}
