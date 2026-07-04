import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { LocationService } from './location.service';

interface NearbyRequest {
  lat: number;
  lng: number;
  radius_m: number;
  limit: number;
  service_token: string;
}

@Controller()
export class LocationGrpcController {
  constructor(
    private readonly location: LocationService,
    private readonly config: ConfigService,
  ) {}

  @GrpcMethod('LocationService', 'GetNearbyCouriers')
  async getNearbyCouriers(data: NearbyRequest) {
    if (data.service_token !== this.config.get('app').interServiceSecret) {
      return { couriers: [] };
    }
    const couriers = await this.location.getNearby(
      data.lat,
      data.lng,
      data.radius_m || undefined,
      data.limit || undefined,
    );
    return {
      couriers: couriers.map((c) => ({
        courier_id: c.courierId,
        lat: c.lat,
        lng: c.lng,
        distance_m: c.distanceM,
      })),
    };
  }
}
