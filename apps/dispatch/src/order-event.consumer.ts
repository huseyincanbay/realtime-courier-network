import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '@rcn/events';
import { QUEUES } from '@rcn/types';
import { DispatchService, OrderPayload } from './dispatch.service';

@Injectable()
export class OrderEventConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderEventConsumer.name);

  constructor(
    private readonly rabbit: RabbitMQService,
    private readonly dispatch: DispatchService,
  ) {}

  async onModuleInit() {
    await this.rabbit.consume(
      { queue: QUEUES.DISPATCH, prefetch: 5 },
      async (msg, ack, nack) => {
        try {
          await this.handle(msg);
          ack();
        } catch (err) {
          this.logger.error(`Failed to process ${msg.type}: ${(err as Error).message}`);
          nack(false);
        }
      },
    );
  }

  private async handle(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'order.created':
        await this.dispatch.handleOrderCreated(msg as unknown as OrderPayload);
        break;
      case 'dispatch.retry':
        await this.dispatch.attemptDispatch(
          msg.payload as OrderPayload,
          msg.attemptNumber as number,
        );
        break;
      case 'order.cancelled':
        await this.dispatch.handleCancelled(msg.orderId as string);
        break;
      default:
        this.logger.debug(`Ignoring event type: ${msg.type}`);
    }
  }
}
