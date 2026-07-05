import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { pinoOptions, typeOrmOptions } from '@rcn/runtime';
import { OutboxEntity, OutboxModule, OutboxService, RabbitMQModule } from '@rcn/events';
import appConfig from './config';
import { DispatchLogEntity } from './dispatch-log.entity';
import { DispatchService } from './dispatch.service';
import { LocationGrpcClient } from './location-grpc.client';
import { RedisLockService } from './redis-lock.service';
import { OrderEventConsumer } from './order-event.consumer';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRoot(pinoOptions('dispatch')),
    TypeOrmModule.forRoot(typeOrmOptions('dispatch', [DispatchLogEntity, OutboxEntity])),
    TypeOrmModule.forFeature([DispatchLogEntity]),
    RabbitMQModule.forRootAsync({
      useFactory: (config: ConfigService) => ({ url: config.get('app').rabbitmqUrl }),
      inject: [ConfigService],
    }),
    OutboxModule,
  ],
  controllers: [HealthController],
  providers: [DispatchService, LocationGrpcClient, RedisLockService, OrderEventConsumer],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly outbox: OutboxService) {}

  onModuleInit() {
    this.outbox.startPublisher(1000);
  }
}
