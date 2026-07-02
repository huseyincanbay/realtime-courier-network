import { Logger } from '@nestjs/common';

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  name: string;
  failureThreshold?: number;
  resetTimeoutMs?: number;
  timeoutMs?: number;
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit "${name}" is open`);
  }
}

export class CircuitBreaker<A extends unknown[], R> {
  private readonly logger = new Logger(CircuitBreaker.name);
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt = 0;

  private readonly threshold: number;
  private readonly resetTimeoutMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly fn: (...args: A) => Promise<R>,
    private readonly opts: BreakerOptions,
  ) {
    this.threshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30000;
    this.timeoutMs = opts.timeoutMs ?? 3000;
  }

  getState(): BreakerState {
    return this.state;
  }

  async fire(...args: A): Promise<R> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.resetTimeoutMs) {
        throw new CircuitOpenError(this.opts.name);
      }
      this.state = 'half-open';
      this.logger.warn(`Circuit "${this.opts.name}" → half-open (probing)`);
    }

    try {
      const result = await this.withTimeout(this.fn(...args));
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state !== 'closed') {
      this.state = 'closed';
      this.logger.log(`Circuit "${this.opts.name}" → closed (recovered)`);
    }
  }

  private onFailure(): void {
    this.failures++;
    if (this.state === 'half-open' || this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      this.logger.error(
        `Circuit "${this.opts.name}" → open (${this.failures} failures)`,
      );
    }
  }

  private withTimeout(p: Promise<R>): Promise<R> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`${this.opts.name} timed out`)),
        this.timeoutMs,
      );
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }
}
