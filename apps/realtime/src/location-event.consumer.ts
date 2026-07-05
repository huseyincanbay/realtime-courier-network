import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RabbitMQService } from '@rcn/events';
import { QUEUES } from '@rcn/types';
import { TrackingGateway } from './tracking.gateway';
import { RedisService } from './redis.service';

@Injectable()
export class LocationEventConsumer implements OnModuleInit {
  private readonly logger = new Logger(LocationEventConsumer.name);
  private readonly lastEmit = new Map<string, number>();
  private readonly throttleMs: number;

  constructor(
    private readonly rabbit: RabbitMQService,
    private readonly gateway: TrackingGateway,
    private readonly membership: RedisService,
    config: ConfigService,
  ) {
    this.throttleMs = config.get('app').locationThrottleMs;
  }

  async onModuleInit() {
    await this.rabbit.consume(
      { queue: QUEUES.REALTIME_LOCATION, prefetch: 50 },
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
    if (msg.type !== 'courier.location.updated') return;
    const courierId = msg.courierId as string;

    const now = Date.now();
    if (now - (this.lastEmit.get(courierId) ?? 0) < this.throttleMs) return;
    this.lastEmit.set(courierId, now);

    const orderId = await this.membership.orderOfCourier(courierId);
    if (!orderId) return;
    this.gateway.emitToOrder(orderId, 'courier:location', {
      courierId,
      lat: msg.lat,
      lng: msg.lng,
    });
  }
}
