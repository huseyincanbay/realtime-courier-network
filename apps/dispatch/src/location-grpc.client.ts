import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ClientGrpc, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { Observable, firstValueFrom } from 'rxjs';
import { CircuitBreaker } from '@rcn/runtime';

interface RawCourier {
  courier_id: string;
  lat: number;
  lng: number;
  distance_m: number;
}
interface RawResponse {
  couriers: RawCourier[];
}
interface LocationServiceGrpc {
  GetNearbyCouriers(data: {
    lat: number;
    lng: number;
    radius_m: number;
    limit: number;
    service_token: string;
  }): Observable<RawResponse>;
}

export interface NearbyCourier {
  courierId: string;
  lat: number;
  lng: number;
  distanceM: number;
}

@Injectable()
export class LocationGrpcClient implements OnModuleInit {
  private readonly logger = new Logger(LocationGrpcClient.name);
  private svc!: LocationServiceGrpc;
  private breaker!: CircuitBreaker<[NearbyRequest], RawResponse>;
  private readonly serviceToken: string;

  constructor(private readonly config: ConfigService) {
    this.serviceToken = this.config.get('app').interServiceSecret;
  }

  onModuleInit() {
    const url = this.config.get('app').locationGrpcUrl;
    const client = ClientProxyFactory.create({
      transport: Transport.GRPC,
      options: {
        package: 'location',
        protoPath: join(__dirname, '../../../proto/location.proto'),
        url,
        loader: { keepCase: true, longs: String, enums: Number, defaults: true },
      },
    }) as unknown as ClientGrpc;

    this.svc = client.getService<LocationServiceGrpc>('LocationService');
    this.breaker = new CircuitBreaker(
      (req: NearbyRequest) => firstValueFrom(this.svc.GetNearbyCouriers(req)),
      { name: 'location-grpc', failureThreshold: 5, resetTimeoutMs: 30000, timeoutMs: 3000 },
    );
    this.logger.log(`Location gRPC client ready (target: ${url})`);
  }

  async getNearby(
    lat: number,
    lng: number,
    radiusM: number,
    limit: number,
  ): Promise<NearbyCourier[]> {
    try {
      const r = await this.breaker.fire({
        lat,
        lng,
        radius_m: radiusM,
        limit,
        service_token: this.serviceToken,
      });
      return (r.couriers ?? []).map((c) => ({
        courierId: c.courier_id,
        lat: c.lat,
        lng: c.lng,
        distanceM: c.distance_m,
      }));
    } catch (err) {
      this.logger.warn(
        `getNearby degraded, returning no couriers: ${(err as Error).message}`,
      );
      return [];
    }
  }
}

interface NearbyRequest {
  lat: number;
  lng: number;
  radius_m: number;
  limit: number;
  service_token: string;
}
