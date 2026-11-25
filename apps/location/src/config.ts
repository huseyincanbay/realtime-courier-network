import { registerAs } from '@nestjs/config';
import { loadCommonConfig, assertProdSecrets } from '@rcn/runtime';

export default registerAs('app', () => {
  assertProdSecrets([
    { name: 'INTER_SERVICE_SECRET', value: process.env.INTER_SERVICE_SECRET, minLength: 32 },
  ]);

  return {
    ...loadCommonConfig(),
    httpPort: parseInt(process.env.LOCATION_HTTP_PORT ?? '3003', 10),
    grpcUrl: `0.0.0.0:${process.env.LOCATION_GRPC_PORT ?? '50051'}`,
    shadowTtl: parseInt(process.env.LOCATION_SHADOW_TTL ?? '60', 10),
    defaultRadiusM: parseInt(process.env.DEFAULT_SEARCH_RADIUS_M ?? '5000', 10),
    maxLocationAgeSec: parseInt(process.env.LOCATION_MAX_AGE_SEC ?? '60', 10),
  };
});
