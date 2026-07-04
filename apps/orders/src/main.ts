import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { createHttpApp } from '@rcn/runtime';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await createHttpApp(AppModule);
  const cfg = app.get(ConfigService).get('app');
  await app.listen(cfg.httpPort);
  app.get(Logger).log(`order-service on :${cfg.httpPort}`);
}

bootstrap().catch((err) => {
  console.error('[orders] bootstrap failed:', err);
  process.exit(1);
});
