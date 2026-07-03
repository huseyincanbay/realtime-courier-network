import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { createHttpApp } from '@rcn/runtime';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await createHttpApp(AppModule);
  const cfg = app.get(ConfigService).get('app');
  await app.listen(cfg.port);
  app.get(Logger).log(`gateway on :${cfg.port}`);
}

bootstrap().catch((err) => {
  console.error('[gateway] bootstrap failed:', err);
  process.exit(1);
});
