import { Controller, Get } from '@nestjs/common';
import { RabbitMQService } from '@rcn/events';
import { RedisService } from './redis.service';
import { RoomManager } from './room.manager';

@Controller('health')
export class HealthController {
  constructor(
    private readonly redis: RedisService,
    private readonly rabbit: RabbitMQService,
    private readonly rooms: RoomManager,
  ) {}

  @Get('liveness')
  liveness() {
    return { status: 'ok' };
  }

  @Get('readiness')
  async readiness() {
    const redis = await this.redis.ping();
    const mq = this.rabbit.isConnected();
    return { status: redis && mq ? 'ok' : 'degraded', redis, mq, connections: this.rooms.count() };
  }
}
