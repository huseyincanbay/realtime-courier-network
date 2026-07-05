import { registerAs } from '@nestjs/config';
import { loadCommonConfig, assertProdSecrets } from '@rcn/runtime';

export default registerAs('app', () => {
  assertProdSecrets([
    { name: 'INTER_SERVICE_SECRET', value: process.env.INTER_SERVICE_SECRET, minLength: 32 },
  ]);

  return {
    ...loadCommonConfig(),
    httpPort: parseInt(process.env.DISPATCH_PORT ?? '3005', 10),
    locationGrpcUrl: process.env.LOCATION_GRPC_URL ?? 'localhost:50051',
    baseRadiusM: parseInt(process.env.DISPATCH_BASE_RADIUS_M ?? '5000', 10),
    maxRadiusM: parseInt(process.env.DISPATCH_MAX_RADIUS_M ?? '15000', 10),
    maxAttempts: parseInt(process.env.DISPATCH_MAX_ATTEMPTS ?? '3', 10),
  };
});
