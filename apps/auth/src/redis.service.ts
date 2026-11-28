import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService) {
    const r = config.get('app').redis;
    this.client = new Redis({
      host: r.host,
      port: r.port,
      password: r.password,
      enableOfflineQueue: false,
    });
  }

  async ping(): Promise<boolean> {
    return this.client.ping().then((r) => r === 'PONG').catch(() => false);
  }

  async blockToken(jti: string, ttlSeconds: number): Promise<void> {
    await this.client.setex(`blocklist:${jti}`, ttlSeconds, '1');
  }

  async isBlocked(jti: string): Promise<boolean> {
    return (await this.client.exists(`blocklist:${jti}`)) === 1;
  }

  async getFailures(email: string): Promise<number> {
    const n = await this.client.get(`login:fail:${email.toLowerCase()}`);
    return n ? parseInt(n, 10) : 0;
  }

  async recordFailure(email: string, windowSeconds: number): Promise<number> {
    const key = `login:fail:${email.toLowerCase()}`;
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, windowSeconds);
    return n;
  }

  async clearFailures(email: string): Promise<void> {
    await this.client.del(`login:fail:${email.toLowerCase()}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
