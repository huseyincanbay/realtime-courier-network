import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface CourierShadow {
  courierId: string;
  latitude: number;
  longitude: number;
  recordedAt: number;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly shadowTtl: number;

  constructor(config: ConfigService) {
    const cfg = config.get('app');
    this.shadowTtl = cfg.shadowTtl;
    this.client = new Redis({
      host: cfg.redis.host,
      port: cfg.redis.port,
      password: cfg.redis.password,
    });
  }

  async setShadow(shadow: CourierShadow): Promise<void> {
    await this.client
      .setex(`courier:${shadow.courierId}:location`, this.shadowTtl, JSON.stringify(shadow))
      .catch(() => undefined);
    await this.client
      .setex(`courier:${shadow.courierId}:status`, this.shadowTtl, 'available')
      .catch(() => undefined);
  }

  async getShadow(courierId: string): Promise<CourierShadow | null> {
    const raw = await this.client.get(`courier:${courierId}:location`).catch(() => null);
    return raw ? (JSON.parse(raw) as CourierShadow) : null;
  }

  async ping(): Promise<boolean> {
    return this.client.ping().then((r) => r === 'PONG').catch(() => false);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
