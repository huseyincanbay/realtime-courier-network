import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly ttl: number;

  constructor(config: ConfigService) {
    const cfg = config.get('app');
    this.ttl = cfg.membershipTtl;
    this.client = new Redis({
      host: cfg.redis.host,
      port: cfg.redis.port,
      password: cfg.redis.password,
    });
  }

  private orderKey(orderId: string): string {
    return `realtime:order:${orderId}`;
  }

  async rememberCustomer(orderId: string, customerId: string): Promise<void> {
    await this.writeField(orderId, 'customerId', customerId);
  }

  async rememberCourier(orderId: string, courierId: string): Promise<void> {
    await this.writeField(orderId, 'courierId', courierId);
    await this.client.setex(`realtime:courier:${courierId}`, this.ttl, orderId);
  }

  async forgetCourier(orderId: string): Promise<void> {
    const courierId = await this.client.hget(this.orderKey(orderId), 'courierId');
    if (!courierId) return;
    const key = `realtime:courier:${courierId}`;
    if ((await this.client.get(key)) === orderId) await this.client.del(key);
  }

  private async writeField(orderId: string, field: string, value: string): Promise<void> {
    await this.client
      .multi()
      .hset(this.orderKey(orderId), field, value)
      .expire(this.orderKey(orderId), this.ttl)
      .exec();
  }

  async canSubscribe(orderId: string, userId: string, role: string): Promise<boolean> {
    if (role === 'admin') return true;
    const m = await this.client.hgetall(this.orderKey(orderId));
    return (
      (!!m.customerId && m.customerId === userId) ||
      (!!m.courierId && m.courierId === userId)
    );
  }

  async orderOfCourier(courierId: string): Promise<string | null> {
    return this.client.get(`realtime:courier:${courierId}`);
  }

  async ping(): Promise<boolean> {
    return this.client.ping().then((r) => r === 'PONG').catch(() => false);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
