import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, derived] = stored.split(':');
  if (!salt || !derived) return false;
  const check = scryptSync(plain, salt, 64);
  const known = Buffer.from(derived, 'hex');
  return known.length === check.length && timingSafeEqual(known, check);
}
