import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { pinoOptions } from '@rcn/runtime';
import appConfig from './config';
import { AuthGrpcClient } from './auth-grpc.client';
import { RedisService } from './redis.service';
import { ProxyService } from './proxy.service';
import { JwtMiddleware } from './jwt.middleware';
import { IdempotencyMiddleware } from './idempotency.middleware';
import {
  AuthProxyController,
  OrdersProxyController,
  LocationProxyController,
  HealthController,
} from './proxy.controllers';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRoot(pinoOptions('gateway')),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
  ],
  controllers: [
    AuthProxyController,
    OrdersProxyController,
    LocationProxyController,
    HealthController,
  ],
  providers: [
    AuthGrpcClient,
    RedisService,
    ProxyService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(JwtMiddleware)
      .forRoutes(OrdersProxyController, LocationProxyController);
    consumer
      .apply(IdempotencyMiddleware)
      .forRoutes(OrdersProxyController, LocationProxyController);
  }
}
