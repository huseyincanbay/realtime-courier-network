import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Params } from 'nestjs-pino';

export function pinoOptions(serviceName: string): Params {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
      base: { service: serviceName },
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const id =
          (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.token',
          '*.refreshToken',
          'req.body.password',
        ],
        remove: true,
      },
      transport: isProduction
        ? undefined
        : {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', singleLine: true, ignore: 'pid,hostname,service' },
          },
    },
  };
}

export function redactEmail(email?: string | null): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
