import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthGrpcClient } from './auth-grpc.client';
import { RedisService } from './redis.service';

@Injectable()
export class JwtMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthGrpcClient,
    private readonly redis: RedisService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing token');

    let user = await this.redis.getCachedUser(token);
    if (!user) {
      user = await this.auth.validate(token);
      if (user.valid) await this.redis.cacheUser(token, user);
    }
    if (!user.valid) {
      throw new UnauthorizedException(user.error ?? 'Invalid token');
    }

    (req as Request & { user: typeof user }).user = user;
    next();
  }
}
