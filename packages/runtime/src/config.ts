export interface CommonConfig {
  nodeEnv: string;
  isProduction: boolean;
  logLevel: string;
  redis: { host: string; port: number; password?: string };
  rabbitmqUrl: string;
  interServiceSecret: string;
}

export function loadCommonConfig(): CommonConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  return {
    nodeEnv,
    isProduction,
    logLevel: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
    },
    rabbitmqUrl:
      process.env.RABBITMQ_URL ?? 'amqp://admin:admin123@localhost:5672/',
    interServiceSecret:
      process.env.INTER_SERVICE_SECRET ?? 'dev-inter-service-secret',
  };
}

export interface RequiredSecret {
  name: string;
  value: string | undefined;
  minLength?: number;
}

export function assertProdSecrets(secrets: RequiredSecret[]): void {
  if (process.env.NODE_ENV !== 'production') return;
  for (const { name, value, minLength = 16 } of secrets) {
    if (!value || value.length < minLength) {
      throw new Error(
        `[config] ${name} must be set (min ${minLength} chars) in production`,
      );
    }
    if (value.startsWith('dev-')) {
      throw new Error(`[config] ${name} still uses a dev default in production`);
    }
  }
}

export function assertMetricsToken(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.METRICS_TOKEN) {
    throw new Error('[config] METRICS_TOKEN is required in production');
  }
}
