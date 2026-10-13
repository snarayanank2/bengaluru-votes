/**
 * TEMPORARY master-password login. In place ONLY until email works for
 * OTP (docs/architecture.md §7, §13) — then this file is deleted, along
 * with its one branch in src/lib/login-flow.ts.
 *
 * `MASTER_PASSWORD` set -> password mode: anyone holding the password can
 * sign in as any EXISTING, ACTIVE account, of any role. It never creates
 * a user. Unset or empty -> OTP mode, exactly as before.
 *
 * The variable is read at call time rather than at module load, so the
 * mode can be flipped per test and so a too-short value throws on the very
 * next request (src/middleware.ts calls `masterLoginEnabled()` on every
 * one) instead of running silently with a guessable password.
 *
 * NON-DISCLOSURE: a wrong password, an unknown contact and a banned or
 * erased account all return the same `{ ok: false }`.
 *
 * PRIVACY: logs carry an opaque user id only — never the contact, never
 * the password.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { logEvent } from './log';
import { normalizeDestination } from './otp';
import { createSession } from './session';

export const MASTER_PASSWORD_MIN_LENGTH = 16;

export type MasterLoginResult = { ok: true; setCookie: string } | { ok: false };

function configuredPassword(): string | null {
  const value = process.env.MASTER_PASSWORD ?? '';
  if (value === '') return null;
  if (value.length < MASTER_PASSWORD_MIN_LENGTH) {
    throw new Error(`MASTER_PASSWORD must be at least ${MASTER_PASSWORD_MIN_LENGTH} characters`);
  }
  return value;
}

export function masterLoginEnabled(): boolean {
  return configuredPassword() !== null;
}

/** SHA-256 first, so `timingSafeEqual` always gets two equal-length buffers. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export async function loginWithMasterPassword(destinationRaw: string, password: string): Promise<MasterLoginResult> {
  const configured = configuredPassword();
  if (configured === null) return { ok: false };

  const passwordOk = timingSafeEqual(digest(password), digest(configured));

  const destination = normalizeDestination(destinationRaw);
  const [user] =
    destination === ''
      ? []
      : await db
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(or(eq(users.email, destination), eq(users.phone, destination)));

  if (!passwordOk || !user || user.status !== 'active') {
    logEvent('master_login_failed', { userId: user?.id ?? null });
    return { ok: false };
  }

  const session = await createSession(user.id);
  logEvent('master_login_succeeded', { userId: user.id });
  return { ok: true, setCookie: session.setCookie };
}
