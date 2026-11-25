import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'locations', name: 'courier_locations' })
export class CourierLocationEntity {
  @PrimaryColumn({ name: 'courier_id', type: 'uuid' })
  courierId: string;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  @Index({ spatial: true })
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location: string;

  @UpdateDateColumn({ name: 'recorded_at' })
  recordedAt: Date;
}
