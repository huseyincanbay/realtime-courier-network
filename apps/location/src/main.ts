import 'reflect-metadata';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { createHttpApp } from '@rcn/runtime';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await createHttpApp(AppModule);
  const cfg = app.get(ConfigService).get('app');

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'location',
      protoPath: join(__dirname, '../../../proto/location.proto'),
      url: cfg.grpcUrl,
      loader: { keepCase: true, longs: String, enums: Number, defaults: true },
    },
  });

  await app.startAllMicroservices();
  await app.listen(cfg.httpPort);
  app.get(Logger).log(`location-service on :${cfg.httpPort} (gRPC ${cfg.grpcUrl})`);
}

bootstrap().catch((err) => {
  console.error('[location] bootstrap failed:', err);
  process.exit(1);
});
