import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RedisService } from './redis.service';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly redis: RedisService,
  ) {}

  @Get('liveness')
  liveness() {
    return { status: 'ok' };
  }

  @Get('readiness')
  async readiness() {
    const db = await this.db.query('SELECT 1').then(() => true).catch(() => false);
    const redis = await this.redis.ping();
    return { status: db && redis ? 'ok' : 'degraded', db, redis };
  }
}
