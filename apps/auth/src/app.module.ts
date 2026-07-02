import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';
import { pinoOptions, typeOrmOptions } from '@rcn/runtime';
import appConfig from './config';
import { UserEntity } from './user.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGrpcController } from './auth.grpc';
import { HealthController } from './health.controller';
import { RedisService } from './redis.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRoot(pinoOptions('auth')),
    TypeOrmModule.forRoot(typeOrmOptions('auth', [UserEntity])),
    TypeOrmModule.forFeature([UserEntity]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.get('app').jwtSecret,
        signOptions: { expiresIn: c.get('app').jwtExpiresIn },
      }),
    }),
  ],
  controllers: [AuthController, AuthGrpcController, HealthController],
  providers: [AuthService, RedisService],
})
export class AppModule {}
