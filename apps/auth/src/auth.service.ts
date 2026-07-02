import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { redactEmail } from '@rcn/runtime';
import { UserEntity } from './user.entity';
import { hashPassword, verifyPassword } from './password';
import { RegisterDto, LoginDto } from './auth.dto';
import { RedisService } from './redis.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.users.findOne({ where: { email: dto.email } });
    if (exists) throw new BadRequestException('Email already registered');

    const user = await this.users.save(
      this.users.create({
        email: dto.email,
        passwordHash: hashPassword(dto.password),
        role: dto.role,
        name: dto.name ?? null,
      }),
    );
    this.logger.log(`Registered ${redactEmail(user.email)} (${user.role})`);
    return this.issue(user);
  }

  async login(dto: LoginDto) {
    const { lockout } = this.config.get('app');

    if ((await this.redis.getFailures(dto.email)) >= lockout.threshold) {
      throw new ForbiddenException('Account temporarily locked');
    }

    const user = await this.users.findOne({ where: { email: dto.email } });
    if (!user || !verifyPassword(dto.password, user.passwordHash)) {
      const fails = await this.redis.recordFailure(dto.email, lockout.windowSec);
      if (fails >= lockout.threshold) {
        this.logger.warn(`${redactEmail(dto.email)} locked (${fails} fails)`);
      }
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) throw new ForbiddenException('Account disabled');

    await this.redis.clearFailures(dto.email);
    return this.issue(user);
  }

  async logout(jti: string, exp: number): Promise<void> {
    const ttl = Math.max(1, exp - Math.floor(Date.now() / 1000));
    await this.redis.blockToken(jti, ttl);
  }

  private issue(user: UserEntity) {
    const jti = randomUUID();
    const accessToken = this.jwt.sign(
      { email: user.email, role: user.role, jti },
      { subject: user.id },
    );
    return {
      user: { id: user.id, email: user.email, role: user.role },
      accessToken,
    };
  }
}
