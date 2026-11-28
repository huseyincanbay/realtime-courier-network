import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  EntitySubscriberInterface,
  In,
  IsNull,
  Repository,
  TransactionCommitEvent,
} from 'typeorm';
import { RabbitMQService } from './rabbitmq.service';
import { OutboxEntity } from './outbox.entity';

export interface OutboxEvent {
  exchange: string;
  routingKey: string;
  payload: Record<string, unknown>;
}

const BATCH_SIZE = 50;

@Injectable()
export class OutboxService implements OnModuleDestroy, EntitySubscriberInterface {
  private readonly logger = new Logger(OutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private wokenWhileDraining = false;

  constructor(
    @InjectRepository(OutboxEntity)
    private readonly repo: Repository<OutboxEntity>,
    private readonly rabbit: RabbitMQService,
    @InjectDataSource() dataSource: DataSource,
  ) {
    dataSource.subscribers.push(this);
  }

  async storeEvent(manager: EntityManager, event: OutboxEvent): Promise<void> {
    const repo = manager.getRepository(OutboxEntity);
    await repo.save(repo.create(event));
    if (manager.queryRunner) manager.queryRunner.data.outboxWritten = true;
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    if (!event.queryRunner.data.outboxWritten) return;
    event.queryRunner.data.outboxWritten = false;
    void this.drain();
  }

  startPublisher(sweepMs = 1000): void {
    this.timer = setInterval(() => void this.drain(), sweepMs);
    this.timer.unref?.();
  }

  private async drain(): Promise<void> {
    if (!this.rabbit.isConnected()) return;
    if (this.draining) {
      this.wokenWhileDraining = true;
      return;
    }
    this.draining = true;
    try {
      let published: number;
      do {
        this.wokenWhileDraining = false;
        published = await this.publishBatch();
      } while (published === BATCH_SIZE || this.wokenWhileDraining);
    } catch (e) {
      this.logger.error(`Publish loop failed: ${(e as Error).message}`);
    } finally {
      this.draining = false;
    }
  }

  private async publishBatch(): Promise<number> {
    const pending = await this.repo.find({
      where: { publishedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: BATCH_SIZE,
    });
    if (pending.length === 0) return 0;
    await Promise.all(
      pending.map((evt) =>
        this.rabbit.publish({ exchange: evt.exchange, routingKey: evt.routingKey }, evt.payload),
      ),
    );
    await this.repo.update({ id: In(pending.map((evt) => evt.id)) }, { publishedAt: new Date() });
    return pending.length;
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
