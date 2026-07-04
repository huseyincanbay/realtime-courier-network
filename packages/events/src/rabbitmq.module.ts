import { DynamicModule, Global, Module } from '@nestjs/common';
import { RabbitMQService } from './rabbitmq.service';

export interface RabbitMQAsyncOptions {
  useFactory: (...args: any[]) => { url: string } | Promise<{ url: string }>;
  inject?: unknown[];
}

@Global()
@Module({})
export class RabbitMQModule {
  static forRootAsync(options: RabbitMQAsyncOptions): DynamicModule {
    return {
      module: RabbitMQModule,
      providers: [
        {
          provide: RabbitMQService,
          useFactory: async (...args: unknown[]) => {
            const cfg = await options.useFactory(...args);
            const service = new RabbitMQService();
            await service.connect(cfg.url);
            return service;
          },
          inject: (options.inject ?? []) as never[],
        },
      ],
      exports: [RabbitMQService],
    };
  }
}
