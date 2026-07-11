import { describe, it, expect } from 'vitest';
import { Logger } from '@nestjs/common';
import { CircuitBreaker, CircuitOpenError, BreakerOptions } from './breaker';

Logger.overrideLogger(false);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = async () => 'ok';
const boom = async () => {
  throw new Error('boom');
};

function make(fn: () => Promise<unknown>, opts: Partial<BreakerOptions> = {}) {
  return new CircuitBreaker<[], unknown>(fn, {
    name: 'test',
    failureThreshold: 3,
    resetTimeoutMs: 20,
    timeoutMs: 50,
    ...opts,
  });
}

describe('CircuitBreaker', () => {
  it('starts closed and passes calls through', async () => {
    const b = make(ok);
    expect(b.getState()).toBe('closed');
    await expect(b.fire()).resolves.toBe('ok');
    expect(b.getState()).toBe('closed');
  });

  it('opens after the failure threshold', async () => {
    const b = make(boom);
    for (let i = 0; i < 3; i++) await expect(b.fire()).rejects.toThrow('boom');
    expect(b.getState()).toBe('open');
  });

  it('fails fast with CircuitOpenError while open', async () => {
    const b = make(boom);
    for (let i = 0; i < 3; i++) await b.fire().catch(() => undefined);
    await expect(b.fire()).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('half-opens after the reset timeout and closes on success', async () => {
    let shouldFail = true;
    const b = make(async () => {
      if (shouldFail) throw new Error('boom');
      return 'ok';
    });
    for (let i = 0; i < 3; i++) await b.fire().catch(() => undefined);
    expect(b.getState()).toBe('open');
    shouldFail = false;
    await sleep(30);
    await expect(b.fire()).resolves.toBe('ok');
    expect(b.getState()).toBe('closed');
  });

  it('re-opens if the half-open probe fails', async () => {
    const b = make(boom);
    for (let i = 0; i < 3; i++) await b.fire().catch(() => undefined);
    await sleep(30);
    await b.fire().catch(() => undefined);
    expect(b.getState()).toBe('open');
  });

  it('resets the failure count after a success', async () => {
    let shouldFail = true;
    const b = make(async () => {
      if (shouldFail) throw new Error('boom');
      return 'ok';
    });
    await b.fire().catch(() => undefined);
    await b.fire().catch(() => undefined);
    shouldFail = false;
    await b.fire();
    shouldFail = true;
    await b.fire().catch(() => undefined);
    await b.fire().catch(() => undefined);
    expect(b.getState()).toBe('closed');
  });

  it('times out a hanging call', async () => {
    const b = make(() => new Promise(() => {}), { timeoutMs: 20 });
    await expect(b.fire()).rejects.toThrow(/timed out/);
  });
});
