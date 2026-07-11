import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { RedisService } from './redis.service';

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Idempotency');
  private readonly lockTtl = 120;
  private readonly cacheTtl = 86400;

  constructor(private readonly redis: RedisService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
    const idem = req.headers['idempotency-key'];
    if (!idem || typeof idem !== 'string') return next();

    const userId = (req as Request & { user?: { userId: string } }).user?.userId ?? 'anon';
    const key = createHash('sha256')
      .update(`${idem}|${userId}|${req.method}|${req.path}`)
      .digest('hex');

    const cached = await this.redis.idemGet(key);
    if (cached) {
      const { status, body } = JSON.parse(cached);
      res.status(status);
      if (typeof body === 'string') {
        res.setHeader('content-type', 'application/json');
        return res.send(body);
      }
      return res.json(body);
    }

    if (!(await this.redis.idemLock(key, this.lockTtl))) {
      throw new HttpException('Request already in progress', HttpStatus.CONFLICT);
    }

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let captured: unknown;
    res.json = (body: unknown) => {
      captured = body;
      return originalJson(body);
    };
    res.send = (body: unknown) => {
      captured = body;
      return originalSend(body);
    };

    res.on('finish', async () => {
      try {
        if (captured !== undefined && res.statusCode < 500) {
          await this.redis.idemStore(
            key,
            JSON.stringify({ status: res.statusCode, body: captured }),
            this.cacheTtl,
          );
        }
      } catch {
        this.logger.warn('Failed to persist idempotent response');
      } finally {
        await this.redis.idemUnlock(key).catch(() => undefined);
      }
    });

    next();
  }
}
