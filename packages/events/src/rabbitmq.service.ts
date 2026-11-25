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
  private channel: amqp.ConfirmChannel | null = null;
  private url = '';
  private closing = false;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private readonly consumers: Array<{ opts: ConsumeOptions; handler: Handler }> = [];

  async connect(url: string): Promise<void> {
    this.url = url;
    await this.establish();
  }

  private async establish(): Promise<void> {
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createConfirmChannel();
    this.reconnectDelay = 1000;
    this.logger.log('Connected to RabbitMQ');
    this.connection.on('error', (err: Error) => {
      this.logger.error(`RabbitMQ connection error: ${err.message}`);
    });
    this.connection.on('close', () => {
      this.connection = null;
      this.channel = null;
      if (this.closing) return;
      this.logger.warn(
        `RabbitMQ connection closed — reconnecting in ${this.reconnectDelay}ms`,
      );
      setTimeout(() => this.reconnect(), this.reconnectDelay).unref?.();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    });
  }

  private async reconnect(): Promise<void> {
    if (this.closing) return;
    try {
      await this.establish();
    } catch (err) {
      this.logger.error(
        `Reconnect failed: ${(err as Error).message} — retrying in ${this.reconnectDelay}ms`,
      );
      setTimeout(() => this.reconnect(), this.reconnectDelay).unref?.();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      return;
    }
    for (const c of this.consumers) {
      await this.subscribe(c.opts, c.handler).catch((err) =>
        this.logger.error(
          `Re-subscribe to ${c.opts.queue} failed: ${(err as Error).message}`,
        ),
      );
    }
    this.logger.log(`Reconnected — ${this.consumers.length} consumer(s) restored`);
  }

  async publish<T>(opts: PublishOptions, payload: T): Promise<void> {
    const channel = this.channel;
    if (!channel) throw new Error('RabbitMQ channel not available');
    await new Promise<void>((resolve, reject) =>
      channel.publish(
        opts.exchange,
        opts.routingKey,
        Buffer.from(JSON.stringify(payload)),
        { persistent: opts.persistent ?? true, contentType: 'application/json' },
        (err) => (err ? reject(err) : resolve()),
      ),
    );
  }

  async consume(opts: ConsumeOptions, handler: Handler): Promise<void> {
    this.consumers.push({ opts, handler });
    await this.subscribe(opts, handler);
  }

  private async subscribe(opts: ConsumeOptions, handler: Handler): Promise<void> {
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
    this.closing = true;
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
