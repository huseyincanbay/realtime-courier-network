import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { pinoOptions, typeOrmOptions } from '@rcn/runtime';
import { OutboxEntity, OutboxModule, OutboxService, RabbitMQModule } from '@rcn/events';
import appConfig from './config';
import { CourierLocationEntity } from './courier-location.entity';
import { LocationService } from './location.service';
import { LocationController } from './location.controller';
import { LocationGrpcController } from './location.grpc';
import { HealthController } from './health.controller';
import { RedisService } from './redis.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRoot(pinoOptions('location')),
    TypeOrmModule.forRoot(
      typeOrmOptions('locations', [CourierLocationEntity, OutboxEntity]),
    ),
    RabbitMQModule.forRootAsync({
      useFactory: (config: ConfigService) => ({ url: config.get('app').rabbitmqUrl }),
      inject: [ConfigService],
    }),
    OutboxModule,
  ],
  controllers: [LocationController, LocationGrpcController, HealthController],
  providers: [LocationService, RedisService],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly outbox: OutboxService) {}

  onModuleInit() {
    this.outbox.startPublisher(1000);
  }
}
