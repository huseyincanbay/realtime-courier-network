import { describe, it, expect } from 'vitest';
import { UserRole, ROLE_TO_INT, INT_TO_ROLE } from './enums';

describe('role int mapping', () => {
  it('round-trips every role through its wire int and back', () => {
    for (const role of Object.values(UserRole)) {
      expect(INT_TO_ROLE[ROLE_TO_INT[role]]).toBe(role);
    }
  });

  it('pins the ints the gRPC layer puts on the wire', () => {
    expect(ROLE_TO_INT[UserRole.CUSTOMER]).toBe(1);
    expect(ROLE_TO_INT[UserRole.COURIER]).toBe(2);
    expect(ROLE_TO_INT[UserRole.ADMIN]).toBe(3);
    expect(INT_TO_ROLE[1]).toBe(UserRole.CUSTOMER);
  });
});
