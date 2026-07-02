import { registerAs } from '@nestjs/config';
import { loadCommonConfig, assertProdSecrets } from '@rcn/runtime';

export default registerAs('app', () => {
  assertProdSecrets([
    { name: 'JWT_SECRET', value: process.env.JWT_SECRET },
    { name: 'INTER_SERVICE_SECRET', value: process.env.INTER_SERVICE_SECRET, minLength: 32 },
  ]);

  return {
    ...loadCommonConfig(),
    httpPort: parseInt(process.env.AUTH_PORT ?? '3001', 10),
    grpcUrl: `0.0.0.0:${process.env.AUTH_GRPC_PORT ?? '50052'}`,
    jwtSecret: process.env.JWT_SECRET ?? 'dev-jwt-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    lockout: { threshold: 5, windowSec: 900 },
  };
});
