import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { pinoOptions } from '@rcn/runtime';
import { RabbitMQModule } from '@rcn/events';
import appConfig from './config';
import { AuthGrpcClient } from './auth-grpc.client';
import { RedisService } from './redis.service';
import { RoomManager } from './room.manager';
import { TrackingGateway } from './tracking.gateway';
import { OrderEventConsumer } from './order-event.consumer';
import { LocationEventConsumer } from './location-event.consumer';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRoot(pinoOptions('realtime')),
    RabbitMQModule.forRootAsync({
      useFactory: (config: ConfigService) => ({ url: config.get('app').rabbitmqUrl }),
      inject: [ConfigService],
    }),
  ],
  controllers: [HealthController],
  providers: [
    AuthGrpcClient,
    RedisService,
    RoomManager,
    TrackingGateway,
    OrderEventConsumer,
    LocationEventConsumer,
  ],
})
export class AppModule {}
