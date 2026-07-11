import { Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger('Proxy');
  private readonly timeoutMs = 5000;

  async forward(req: Request, res: Response, targetBase: string): Promise<void> {
    const url = `${targetBase}${req.originalUrl}`;
    const headers: Record<string, string> = {
      'content-type': req.headers['content-type'] ?? 'application/json',
      'x-request-id': (req.headers['x-request-id'] as string) ?? '',
    };
    if (req.headers.authorization) headers.authorization = req.headers.authorization;

    const user = (req as Request & { user?: { userId: string; role: string } }).user;
    if (user) {
      headers['x-user-id'] = user.userId;
      headers['x-user-role'] = user.role;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const init: RequestInit = { method: req.method, headers, signal: controller.signal };
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        init.body = JSON.stringify(req.body);
      }
      const upstream = await fetch(url, init);
      const body = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('content-type', ct);
      res.send(body);
    } catch (err) {
      this.logger.error(`Proxy to ${targetBase} failed: ${(err as Error).message}`);
      res.status(502).json({ success: false, message: 'Upstream service unavailable' });
    } finally {
      clearTimeout(timer);
    }
  }
}
