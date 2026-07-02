import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function typeOrmOptions(
  schema: string,
  entities: unknown[],
): TypeOrmModuleOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5433', 10),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'dispatch',
    schema,
    entities: entities as never,
    synchronize: isProduction ? false : process.env.DB_SYNCHRONIZE !== 'false',
    ssl: isProduction ? { rejectUnauthorized: true } : false,
  };
}
