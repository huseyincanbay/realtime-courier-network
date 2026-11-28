import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const ONE_OUTCOME_PER_ATTEMPT = 'one_outcome_per_attempt';
export const ONE_OPEN_ORDER_PER_COURIER = 'one_open_order_per_courier';

@Entity({ schema: 'dispatch', name: 'dispatch_logs' })
@Index(ONE_OUTCOME_PER_ATTEMPT, ['orderId', 'attemptNumber'], {
  unique: true,
  where: '"attempt_number" > 0',
})
@Index(ONE_OPEN_ORDER_PER_COURIER, ['courierId'], {
  unique: true,
  where: '"is_open"',
})
export class DispatchLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column()
  status: string;

  @Column({ name: 'courier_id', type: 'uuid', nullable: true })
  courierId: string | null;

  @Column({ name: 'distance_m', type: 'double precision', nullable: true })
  distanceM: number | null;

  @Column({ name: 'attempt_number', type: 'int', default: 1 })
  attemptNumber: number;

  @Column({ name: 'couriers_found', type: 'int', default: 0 })
  couriersFound: number;

  @Column({ name: 'is_open', default: false })
  open: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
