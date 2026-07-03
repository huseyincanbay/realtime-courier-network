import { registerAs } from '@nestjs/config';
import { loadCommonConfig, assertProdSecrets } from '@rcn/runtime';

export default registerAs('app', () => {
  assertProdSecrets([
    { name: 'INTER_SERVICE_SECRET', value: process.env.INTER_SERVICE_SECRET, minLength: 32 },
  ]);

  return {
    ...loadCommonConfig(),
    port: parseInt(process.env.GATEWAY_PORT ?? '4000', 10),
    authGrpcUrl: process.env.AUTH_GRPC_URL ?? 'localhost:50052',
    tokenCacheTtl: parseInt(process.env.TOKEN_CACHE_TTL ?? '120', 10),
    services: {
      auth: process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001',
      orders: process.env.ORDER_SERVICE_URL ?? 'http://localhost:3002',
      location: process.env.LOCATION_SERVICE_URL ?? 'http://localhost:3003',
    },
  };
});
