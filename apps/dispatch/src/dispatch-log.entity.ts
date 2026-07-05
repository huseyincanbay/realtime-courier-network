import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ schema: 'dispatch', name: 'dispatch_logs' })
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
