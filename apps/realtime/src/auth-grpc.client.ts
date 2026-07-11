import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ClientGrpc, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { Observable, firstValueFrom } from 'rxjs';
import { CircuitBreaker, CircuitOpenError } from '@rcn/runtime';
import { INT_TO_ROLE } from '@rcn/types';

interface RawResponse {
  valid: boolean;
  user: { user_id: string; email: string; role: number } | null;
  error: string;
}
interface AuthServiceGrpc {
  validateToken(data: { token: string; service_token: string }): Observable<RawResponse>;
}

export interface ValidatedUser {
  valid: boolean;
  userId?: string;
  role?: string;
}

@Injectable()
export class AuthGrpcClient implements OnModuleInit {
  private readonly logger = new Logger(AuthGrpcClient.name);
  private svc!: AuthServiceGrpc;
  private breaker!: CircuitBreaker<[string], RawResponse>;
  private readonly serviceToken: string;

  constructor(private readonly config: ConfigService) {
    this.serviceToken = this.config.get('app').interServiceSecret;
  }

  onModuleInit() {
    const url = this.config.get('app').authGrpcUrl;
    const client = ClientProxyFactory.create({
      transport: Transport.GRPC,
      options: {
        package: 'auth',
        protoPath: join(__dirname, '../../../proto/auth.proto'),
        url,
        loader: { keepCase: true, longs: String, enums: Number, defaults: true },
      },
    }) as unknown as ClientGrpc;
    this.svc = client.getService<AuthServiceGrpc>('AuthService');
    this.breaker = new CircuitBreaker(
      (token: string) =>
        firstValueFrom(this.svc.validateToken({ token, service_token: this.serviceToken })),
      { name: 'realtime-auth-grpc', failureThreshold: 5, resetTimeoutMs: 30000, timeoutMs: 3000 },
    );
    this.logger.log(`Auth gRPC client ready (target: ${url})`);
  }

  async validate(token: string): Promise<ValidatedUser> {
    try {
      const r = await this.breaker.fire(token);
      if (!r.valid || !r.user) return { valid: false };
      return { valid: true, userId: r.user.user_id, role: INT_TO_ROLE[r.user.role] };
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        this.logger.warn('Auth circuit open — failing fast');
      }
      return { valid: false };
    }
  }
}
