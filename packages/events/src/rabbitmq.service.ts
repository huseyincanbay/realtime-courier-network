import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';

export interface PublishOptions {
  exchange: string;
  routingKey: string;
  persistent?: boolean;
}

export interface ConsumeOptions {
  queue: string;
  prefetch?: number;
}

type Handler = (
  msg: Record<string, unknown>,
  ack: () => void,
  nack: (requeue?: boolean) => void,
) => Promise<void>;

@Injectable()
export class RabbitMQService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;

  async connect(url: string): Promise<void> {
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();
    this.logger.log('Connected to RabbitMQ');
    this.connection.on('close', () => {
      this.logger.warn('RabbitMQ connection closed');
      this.connection = null;
      this.channel = null;
    });
  }

  async publish<T>(opts: PublishOptions, payload: T): Promise<boolean> {
    if (!this.channel) throw new Error('RabbitMQ channel not available');
    return this.channel.publish(
      opts.exchange,
      opts.routingKey,
      Buffer.from(JSON.stringify(payload)),
      { persistent: opts.persistent ?? true, contentType: 'application/json' },
    );
  }

  async consume(opts: ConsumeOptions, handler: Handler): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ channel not available');
    const channel = this.channel;
    await channel.checkQueue(opts.queue);
    await channel.prefetch(opts.prefetch ?? 10);
    this.logger.log(`Consuming from ${opts.queue}`);

    await channel.consume(opts.queue, async (msg) => {
      if (!msg) return;
      try {
        const content = JSON.parse(msg.content.toString()) as Record<string, unknown>;
        await handler(
          content,
          () => channel.ack(msg),
          (requeue = false) => channel.nack(msg, false, requeue),
        );
      } catch (err) {
        this.logger.error(`Consume error on ${opts.queue}: ${(err as Error).message}`);
        channel.nack(msg, false, false);
      }
    });
  }

  isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
