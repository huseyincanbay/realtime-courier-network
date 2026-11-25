import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisLockService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly lockTtl = 3600;
  private readonly releaseScript =
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

  constructor(config: ConfigService) {
    const cfg = config.get('app');
    this.client = new Redis({
      host: cfg.redis.host,
      port: cfg.redis.port,
      password: cfg.redis.password,
    });
  }

  async acquireCourier(courierId: string, orderId: string): Promise<boolean> {
    const res = await this.client.set(
      `lock:courier:${courierId}`,
      orderId,
      'EX',
      this.lockTtl,
      'NX',
    );
    return res === 'OK';
  }

  async releaseCourier(courierId: string, orderId: string): Promise<void> {
    await this.client.eval(this.releaseScript, 1, `lock:courier:${courierId}`, orderId);
  }

  async isOnline(courierId: string): Promise<boolean> {
    return (await this.client.exists(`courier:${courierId}:status`)) === 1;
  }

  async ping(): Promise<boolean> {
    return this.client.ping().then((r) => r === 'PONG').catch(() => false);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
