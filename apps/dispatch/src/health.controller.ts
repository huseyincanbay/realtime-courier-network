import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RabbitMQService } from '@rcn/events';
import { RedisLockService } from './redis-lock.service';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly redis: RedisLockService,
    private readonly rabbit: RabbitMQService,
  ) {}

  @Get('liveness')
  liveness() {
    return { status: 'ok' };
  }

  @Get('readiness')
  async readiness() {
    const db = await this.db.query('SELECT 1').then(() => true).catch(() => false);
    const redis = await this.redis.ping();
    const mq = this.rabbit.isConnected();
    return { status: db && redis && mq ? 'ok' : 'degraded', db, redis, mq };
  }
}
