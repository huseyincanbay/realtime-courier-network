import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { RabbitMQService } from './rabbitmq.service';
import { OutboxEntity } from './outbox.entity';

export interface OutboxEvent {
  exchange: string;
  routingKey: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private publishing = false;

  constructor(
    @InjectRepository(OutboxEntity)
    private readonly repo: Repository<OutboxEntity>,
    private readonly rabbit: RabbitMQService,
  ) {}

  async storeEvent(manager: EntityManager, event: OutboxEvent): Promise<void> {
    const repo = manager.getRepository(OutboxEntity);
    await repo.save(repo.create(event));
  }

  startPublisher(intervalMs = 1000): void {
    this.timer = setInterval(() => {
      if (this.publishing) return;
      this.publishing = true;
      this.publishPending()
        .catch((e) => this.logger.error(`Publish loop failed: ${(e as Error).message}`))
        .finally(() => {
          this.publishing = false;
        });
    }, intervalMs);
    this.timer.unref?.();
  }

  private async publishPending(): Promise<void> {
    const pending = await this.repo.find({
      where: { publishedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: 50,
    });
    for (const evt of pending) {
      await this.rabbit.publish(
        { exchange: evt.exchange, routingKey: evt.routingKey },
        evt.payload,
      );
      evt.publishedAt = new Date();
      await this.repo.save(evt);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
