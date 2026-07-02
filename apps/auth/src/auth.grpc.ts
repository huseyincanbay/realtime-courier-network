import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ROLE_TO_INT, UserRole } from '@rcn/types';
import { RedisService } from './redis.service';

interface ValidateTokenRequest {
  token: string;
  service_token: string;
}

@Controller()
export class AuthGrpcController {
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @GrpcMethod('AuthService', 'ValidateToken')
  async validateToken(data: ValidateTokenRequest) {
    if (data.service_token !== this.config.get('app').interServiceSecret) {
      return { valid: false, user: null, error: 'invalid service token' };
    }
    try {
      const p = this.jwt.verify(data.token);
      if (await this.redis.isBlocked(p.jti)) {
        return { valid: false, user: null, error: 'token revoked' };
      }
      return {
        valid: true,
        user: {
          user_id: p.sub,
          email: p.email,
          role: ROLE_TO_INT[p.role as UserRole],
        },
        error: '',
      };
    } catch {
      return { valid: false, user: null, error: 'invalid token' };
    }
  }
}
