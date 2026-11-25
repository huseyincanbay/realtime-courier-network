import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { OutboxService } from '@rcn/events';
import {
  CourierLocationUpdatedEvent,
  EVENT_VERSIONS,
  EXCHANGES,
  ROUTING_KEYS,
} from '@rcn/types';
import { RedisService } from './redis.service';

export interface NearbyCourier {
  courierId: string;
  lat: number;
  lng: number;
  distanceM: number;
}

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async updateLocation(courierId: string, role: string, latitude: number, longitude: number) {
    if (role !== 'courier') throw new ForbiddenException('Only couriers report a location');
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO locations.courier_locations (courier_id, latitude, longitude, location)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography)
         ON CONFLICT (courier_id) DO UPDATE
         SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
             location = EXCLUDED.location, recorded_at = now()`,
        [courierId, latitude, longitude],
      );
      await this.outbox.storeEvent(manager, {
        exchange: EXCHANGES.LOCATION_EVENTS,
        routingKey: ROUTING_KEYS.COURIER_LOCATION_UPDATED,
        payload: {
          version: EVENT_VERSIONS.COURIER_LOCATION_UPDATED,
          type: 'courier.location.updated',
          timestamp: new Date().toISOString(),
          courierId,
          lat: latitude,
          lng: longitude,
        } satisfies CourierLocationUpdatedEvent,
      });
    });

    await this.redis.setShadow({
      courierId,
      latitude,
      longitude,
      recordedAt: Date.now(),
    });
    return { success: true };
  }

  async getNearby(
    lat: number,
    lng: number,
    radiusM?: number,
    limit?: number,
  ): Promise<NearbyCourier[]> {
    const cfg = this.config.get('app');
    const radius = radiusM ?? cfg.defaultRadiusM;
    const max = limit ?? 10;
    const rows = await this.dataSource.query(
      `SELECT courier_id, latitude, longitude,
              ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m
       FROM locations.courier_locations
       WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
         AND recorded_at > now() - make_interval(secs => $5)
       ORDER BY distance_m ASC
       LIMIT $4`,
      [lat, lng, radius, max, cfg.maxLocationAgeSec],
    );
    return rows.map((r: Record<string, string>) => ({
      courierId: r.courier_id,
      lat: parseFloat(r.latitude),
      lng: parseFloat(r.longitude),
      distanceM: parseFloat(r.distance_m),
    }));
  }

  async getCourierLocation(courierId: string, requesterId?: string, role?: string) {
    if (role !== 'admin' && requesterId !== courierId) {
      throw new ForbiddenException('You can only read your own location');
    }
    const shadow = await this.redis.getShadow(courierId);
    if (shadow) return shadow;
    const [row] = await this.dataSource.query(
      `SELECT courier_id, latitude, longitude, extract(epoch from recorded_at)*1000 AS recorded_at
       FROM locations.courier_locations WHERE courier_id = $1`,
      [courierId],
    );
    if (!row) throw new NotFoundException('No location for courier');
    return {
      courierId: row.courier_id,
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
      recordedAt: parseFloat(row.recorded_at),
    };
  }
}
