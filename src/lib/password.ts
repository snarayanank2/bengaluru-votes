/**
 * Staff password hashing — scrypt from node:crypto (no dependency).
 *
 * Stored format: `scrypt$N$r$p$<salt b64>$<hash b64>`, so the cost
 * parameters travel with each hash and can be raised later without
 * invalidating existing ones.
 *
 * Passwords are set only by an admin (src/lib/admin.ts `setStaffPassword`) or
 * the `npm run set-password` CLI; there is no self-service reset.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const PASSWORD_MIN_LENGTH = 16;
export const PASSWORD_MAX_LENGTH = 256;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;

function scrypt(secret: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(secret.normalize('NFKC'), salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** `null` when acceptable, otherwise a stable error code. */
export function passwordProblem(candidate: string): 'password_too_short' | 'password_too_long' | null {
  if (candidate.length < PASSWORD_MIN_LENGTH) return 'password_too_short';
  if (candidate.length > PASSWORD_MAX_LENGTH) return 'password_too_long';
  return null;
}

export async function hashPassword(candidate: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(candidate, salt, KEY_LEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(candidate: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![n, r, p].every(Number.isInteger)) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  const actual = await scrypt(candidate, salt, expected.length, { N: n, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash nobody knows the secret to, verified against when the email is unknown so timing does not reveal which emails exist. */
let decoy: Promise<string> | undefined;
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(24).toString('hex'));
  return decoy;
}

/** A random value for seeds and the CLI (48 hex chars, well over the minimum). */
export function generatePassword(): string {
  return randomBytes(24).toString('hex');
}
