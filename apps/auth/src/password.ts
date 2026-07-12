import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(plain, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [salt, derived] = stored.split(':');
  if (!salt || !derived) return false;
  const check = (await scryptAsync(plain, salt, 64)) as Buffer;
  const known = Buffer.from(derived, 'hex');
  return known.length === check.length && timingSafeEqual(known, check);
}
