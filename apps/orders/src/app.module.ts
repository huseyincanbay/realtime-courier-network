import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { pinoOptions, typeOrmOptions } from '@rcn/runtime';
import { OutboxEntity, OutboxModule, OutboxService, RabbitMQModule } from '@rcn/events';
import appConfig from './config';
import { OrderEntity } from './order.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderProjectionConsumer } from './order-projection.consumer';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRoot(pinoOptions('orders')),
    TypeOrmModule.forRoot(typeOrmOptions('orders', [OrderEntity, OutboxEntity])),
    TypeOrmModule.forFeature([OrderEntity]),
    RabbitMQModule.forRootAsync({
      useFactory: (config: ConfigService) => ({ url: config.get('app').rabbitmqUrl }),
      inject: [ConfigService],
    }),
    OutboxModule,
  ],
  controllers: [OrdersController, HealthController],
  providers: [OrdersService, OrderProjectionConsumer],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly outbox: OutboxService) {}

  onModuleInit() {
    this.outbox.startPublisher(1000);
  }
}
