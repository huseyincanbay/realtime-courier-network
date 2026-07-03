import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { ValidatedUser } from './auth-grpc.client';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly tokenTtl: number;

  constructor(config: ConfigService) {
    const cfg = config.get('app');
    this.tokenTtl = cfg.tokenCacheTtl;
    this.client = new Redis({
      host: cfg.redis.host,
      port: cfg.redis.port,
      password: cfg.redis.password,
    });
  }

  private tokenKey(token: string): string {
    return `auth:token:${createHash('sha256').update(token).digest('hex')}`;
  }

  async getCachedUser(token: string): Promise<ValidatedUser | null> {
    const raw = await this.client.get(this.tokenKey(token)).catch(() => null);
    return raw ? (JSON.parse(raw) as ValidatedUser) : null;
  }

  async cacheUser(token: string, user: ValidatedUser): Promise<void> {
    await this.client
      .setex(this.tokenKey(token), this.tokenTtl, JSON.stringify(user))
      .catch(() => undefined);
  }

  async idemGet(key: string): Promise<string | null> {
    return this.client.get(`idem:${key}`);
  }

  async idemLock(key: string, ttlSeconds: number): Promise<boolean> {
    return (
      (await this.client.set(`idem:lock:${key}`, '1', 'EX', ttlSeconds, 'NX')) ===
      'OK'
    );
  }

  async idemStore(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.setex(`idem:${key}`, ttlSeconds, value);
  }

  async idemUnlock(key: string): Promise<void> {
    await this.client.del(`idem:lock:${key}`);
  }

  async ping(): Promise<boolean> {
    return this.client.ping().then((r) => r === 'PONG').catch(() => false);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
