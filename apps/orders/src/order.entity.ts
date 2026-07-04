import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeliveryPriority, OrderStatus } from '@rcn/types';

@Entity({ schema: 'orders', name: 'orders' })
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'order_number' })
  orderNumber: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'courier_id', type: 'uuid', nullable: true })
  courierId: string | null;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Column({ type: 'enum', enum: DeliveryPriority, default: DeliveryPriority.NORMAL })
  priority: DeliveryPriority;

  @Column({ name: 'pickup_lat', type: 'double precision' })
  pickupLat: number;

  @Column({ name: 'pickup_lng', type: 'double precision' })
  pickupLng: number;

  @Column({ name: 'dropoff_lat', type: 'double precision' })
  dropoffLat: number;

  @Column({ name: 'dropoff_lng', type: 'double precision' })
  dropoffLng: number;

  @Column({ name: 'cancel_reason', type: 'varchar', nullable: true })
  cancelReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
