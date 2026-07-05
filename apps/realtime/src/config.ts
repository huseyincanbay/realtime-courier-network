import { registerAs } from '@nestjs/config';
import { loadCommonConfig, assertProdSecrets } from '@rcn/runtime';

export default registerAs('app', () => {
  assertProdSecrets([
    { name: 'INTER_SERVICE_SECRET', value: process.env.INTER_SERVICE_SECRET, minLength: 32 },
  ]);

  return {
    ...loadCommonConfig(),
    port: parseInt(process.env.REALTIME_PORT ?? '3004', 10),
    authGrpcUrl: process.env.AUTH_GRPC_URL ?? 'localhost:50052',
    membershipTtl: parseInt(process.env.REALTIME_MEMBERSHIP_TTL ?? '604800', 10),
    locationThrottleMs: parseInt(process.env.LOCATION_THROTTLE_MS ?? '500', 10),
  };
});
