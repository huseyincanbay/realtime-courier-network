import { All, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import { RedisService } from './redis.service';

@Controller('auth')
export class AuthProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) await this.redis.evictToken(token);
    return this.proxy.forward(req, res, this.config.get('app').services.auth);
  }

  @All(['', '*'])
  forward(@Req() req: Request, @Res() res: Response) {
    return this.proxy.forward(req, res, this.config.get('app').services.auth);
  }
}

@Controller('orders')
export class OrdersProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
  ) {}

  @All(['', '*'])
  forward(@Req() req: Request, @Res() res: Response) {
    return this.proxy.forward(req, res, this.config.get('app').services.orders);
  }
}

@Controller('location')
export class LocationProxyController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
  ) {}

  @All(['', '*'])
  forward(@Req() req: Request, @Res() res: Response) {
    return this.proxy.forward(req, res, this.config.get('app').services.location);
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly redis: RedisService) {}

  @Get('liveness')
  liveness() {
    return { status: 'ok' };
  }

  @Get('readiness')
  async readiness() {
    const redis = await this.redis.ping();
    return { status: redis ? 'ok' : 'degraded', redis };
  }
}
