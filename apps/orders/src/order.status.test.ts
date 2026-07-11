import { describe, it, expect } from 'vitest';
import { OrderStatus } from '@rcn/types';
import { canTransition, VALID_TRANSITIONS } from './order.status';

describe('order state machine', () => {
  it('allows the forward delivery path', () => {
    expect(canTransition(OrderStatus.PENDING, OrderStatus.ASSIGNED)).toBe(true);
    expect(canTransition(OrderStatus.ASSIGNED, OrderStatus.PICKED_UP)).toBe(true);
    expect(canTransition(OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT)).toBe(true);
    expect(canTransition(OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED)).toBe(true);
  });

  it('allows cancelling from any non-terminal state', () => {
    for (const from of [
      OrderStatus.PENDING,
      OrderStatus.ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.IN_TRANSIT,
    ]) {
      expect(canTransition(from, OrderStatus.CANCELLED)).toBe(true);
    }
  });

  it('rejects skipping a step', () => {
    expect(canTransition(OrderStatus.PENDING, OrderStatus.PICKED_UP)).toBe(false);
    expect(canTransition(OrderStatus.PENDING, OrderStatus.DELIVERED)).toBe(false);
    expect(canTransition(OrderStatus.ASSIGNED, OrderStatus.DELIVERED)).toBe(false);
  });

  it('rejects moving out of a terminal state', () => {
    expect(VALID_TRANSITIONS[OrderStatus.DELIVERED]).toEqual([]);
    expect(VALID_TRANSITIONS[OrderStatus.CANCELLED]).toEqual([]);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.ASSIGNED)).toBe(false);
    expect(canTransition(OrderStatus.CANCELLED, OrderStatus.PENDING)).toBe(false);
  });

  it('rejects going backwards', () => {
    expect(canTransition(OrderStatus.ASSIGNED, OrderStatus.PENDING)).toBe(false);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.IN_TRANSIT)).toBe(false);
  });
});
