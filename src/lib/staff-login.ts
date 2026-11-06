/**
 * Staff sign-in with a per-account credential (docs/architecture.md §4).
 *
 * `/login` takes an ACTIVE staff account's email plus that account's own
 * password, checked against `users.password_hash` (scrypt, src/lib/password.ts).
 * It never creates a user. An account with no password set cannot sign in.
 *
 * NON-DISCLOSURE: a wrong password, an unknown email, an account with no
 * password and a banned or erased account all return the same `{ ok: false }`,
 * and a hash is verified in every case so timing does not distinguish them.
 *
 * PRIVACY: logs carry an opaque user id only — never the email, never the
 * password.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { logEvent } from './log';
import { decoyHash, verifyPassword } from './password';
import { createSession } from './session';

export type StaffLoginResult = { ok: true; setCookie: string } | { ok: false };

/** Lowercased and trimmed: `users.email` is stored that way. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function loginWithPassword(destinationRaw: string, submitted: string): Promise<StaffLoginResult> {
  const email = normalizeEmail(destinationRaw);
  const [user] =
    email === ''
      ? []
      : await db
          .select({ id: users.id, status: users.status, passwordHash: users.passwordHash })
          .from(users)
          .where(eq(users.email, email));

  const matches = await verifyPassword(submitted, user?.passwordHash ?? (await decoyHash()));

  if (!matches || !user || !user.passwordHash || user.status !== 'active') {
    logEvent('staff_login_failed', { userId: user?.id ?? null });
    return { ok: false };
  }

  const session = await createSession(user.id);
  logEvent('staff_login_succeeded', { userId: user.id });
  return { ok: true, setCookie: session.setCookie };
}
