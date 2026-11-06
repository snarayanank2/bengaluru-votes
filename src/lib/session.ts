/**
 * Signed sliding sessions (architecture.md §7 "API surface & auth", §13
 * "Security") — the single session mechanism behind staff sign-in
 * (src/lib/staff-login.ts) and the role middleware (Task 26), for the
 * three staff roles (transcriber, curator, admin). Anonymous read paths
 * never touch this module.
 *
 * COOKIE FORMAT: the cookie value is `${id}.${hmac}` where `id` is 32 random
 * bytes (hex, from the `sessions` table PK) and `hmac` is
 * HMAC-SHA256(id, SESSION_SECRET) (hex). The id alone is never trusted for a
 * DB lookup — the HMAC is verified FIRST, in constant time, so a forged or
 * enumerated id can't be used to probe the sessions table or observe timing
 * differences between "bad signature" and "signature ok, no such row".
 *
 * COOKIE ATTRIBUTES: exactly `HttpOnly; Secure; SameSite=Lax; Path=/`
 * (architecture §7/§13, binding). `Secure` means the browser will not send
 * this cookie over plain HTTP — correct in production (TLS-terminated at
 * nginx) and irrelevant in tests, which talk to this module directly rather
 * than through a browser.
 *
 * SLIDING EXPIRY / WRITE-BEHIND: every role gets the same 1-hour idle
 * timeout. `readSession` is called on every authenticated request, so
 * sliding the expiry on *every* call would mean a DB write on every
 * authenticated request. Instead the expiry is only pushed back out to
 * `now + 1h` once its remaining lifetime has dropped below 55 minutes (i.e.
 * more than 5 minutes have elapsed since the last slide/creation) — most
 * requests within that 5-minute window just read, no write. Anonymous,
 * publicly cached routes (nginx micro-cache, architecture §5) never call
 * `readSession` at all, so they stay fully read-only regardless of this.
 *
 * SESSION_SECRET: required in production; if unset there this module throws
 * at import time (fail closed — a session store signed with a guessable or
 * absent secret is worse than not booting). In any other NODE_ENV (dev,
 * test, or simply unset) a single fixed, publicly-known development secret
 * is used instead, with a one-time console.warn — good enough for local/dev/
 * CI work against a throwaway DB, never acceptable in production.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { roleEnum, sessions, users } from '../db/schema';

export type Role = (typeof roleEnum.enumValues)[number];

export const SESSION_COOKIE = 'bv_session';

/** Sliding idle timeout for all roles (architecture §7). */
export const SESSION_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Only slide (re-issue) the expiry once less than this much time remains —
 * i.e. once more than 5 minutes have elapsed since the session was created
 * or last slid. Keeps the common case (a burst of requests within the same
 * few minutes) to zero extra writes.
 */
const SLIDE_IF_REMAINING_UNDER_MS = 55 * 60 * 1000;

const DEV_SESSION_SECRET = 'dev-only-insecure-session-secret-DO-NOT-USE-IN-PRODUCTION';

/**
 * Resolved once, at module load, so a misconfigured production deploy fails
 * closed immediately (at boot) rather than on the first request.
 */
function resolveSessionSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured) return configured;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET is not set. Refusing to start in production without it ' +
        '(src/lib/session.ts fails closed rather than sign sessions with a ' +
        'guessable secret).',
    );
  }

  console.warn(
    '[session] SESSION_SECRET is not set; using a fixed, publicly-known ' +
      'development secret. This is INSECURE and must never happen in ' +
      'production (NODE_ENV=production throws instead of falling back).',
  );
  return DEV_SESSION_SECRET;
}

/**
 * The resolved session-signing secret (fail-closed resolution rule:
 * `resolveSessionSecret` above).
 */
export const SESSION_SECRET = resolveSessionSecret();

/**
 * The exact `Set-Cookie` header value for issuing/refreshing the session
 * cookie. `value` is the full `id.hmac` cookie value (see module docstring).
 */
export function sessionCookieString(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

/** The exact `Set-Cookie` header value to clear the session cookie (logout). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function computeHmac(id: string): string {
  return createHmac('sha256', SESSION_SECRET).update(id).digest('hex');
}

/** Constant-time HMAC check. Never throws — a length mismatch is a `false`, not an exception. */
function verifyHmac(id: string, providedHmacHex: string): boolean {
  const expectedBuf = Buffer.from(computeHmac(id), 'hex');
  const providedBuf = Buffer.from(providedHmacHex, 'hex');
  // crypto.timingSafeEqual throws on unequal-length buffers, and a
  // non-hex-encodable string, or a hex string of a different length,
  // decodes to a different-length Buffer — so this guard must come first.
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/** Splits `id.hmac`; `null` for anything that isn't exactly two non-empty segments. */
function parseCookieValue(cookieValue: string): { id: string; hmac: string } | null {
  if (typeof cookieValue !== 'string' || cookieValue.length === 0) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [id, hmac] = parts;
  if (!id || !hmac) return null;
  return { id, hmac };
}

/**
 * Creates a new session row for `userId` with a fresh 1-hour expiry.
 *
 * Return shape (documented precisely — src/lib/staff-login.ts and
 * Task 26's middleware both depend on it):
 *   - `id`: the raw session id (the `sessions.id` DB primary key) — 32
 *     random bytes, hex. Exposed mainly for tests/introspection; callers
 *     issuing a cookie should use `cookieValue`/`setCookie` instead.
 *   - `cookieValue`: the value to store in the cookie, `${id}.${hmac}`.
 *     Use this if you're composing your own Set-Cookie header or passing
 *     the value to another cookie-setting API (e.g. Astro's `cookies.set`).
 *   - `setCookie`: the complete `Set-Cookie` header string
 *     (`sessionCookieString(cookieValue, SESSION_TTL_SECONDS)`), ready to
 *     write directly to a response header.
 */
export async function createSession(
  userId: number,
): Promise<{ id: string; cookieValue: string; setCookie: string }> {
  const id = randomBytes(32).toString('hex');
  const hmac = computeHmac(id);
  const cookieValue = `${id}.${hmac}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await db.insert(sessions).values({ id, userId, expiresAt });

  return { id, cookieValue, setCookie: sessionCookieString(cookieValue, SESSION_TTL_SECONDS) };
}

/**
 * Verifies and resolves a session cookie value to `{ userId, role }`, or
 * `null` for anything invalid: malformed cookie, bad/tampered HMAC, no such
 * session, expired session, or a user that is no longer `active` (banned or
 * erased). On success, slides the expiry (write-behind — see module
 * docstring) before returning.
 *
 * Public, anonymously-cached routes (architecture §5) must never call this
 * — doing so would both add a DB write to a cached read path and make the
 * page vary per-visitor under a single cached HTML variant.
 */
export async function readSession(cookieValue: string): Promise<{ userId: number; role: Role } | null> {
  const parsed = parseCookieValue(cookieValue);
  if (!parsed) return null;
  const { id, hmac } = parsed;

  if (!verifyHmac(id, hmac)) return null;

  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;

  const [user] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!user || user.status !== 'active') return null;

  if (session.expiresAt.getTime() - now < SLIDE_IF_REMAINING_UNDER_MS) {
    const newExpiresAt = new Date(now + SESSION_TTL_SECONDS * 1000);
    await db.update(sessions).set({ expiresAt: newExpiresAt }).where(eq(sessions.id, id));
  }

  return { userId: user.id, role: user.role };
}

/**
 * Deletes the session row for `cookieValue`'s id, if any (best-effort — a
 * cookie that's malformed or already gone is a silent no-op, never a
 * throw). Callers should still send `clearSessionCookie()` in the response
 * regardless of whether a row existed.
 */
export async function destroySession(cookieValue: string): Promise<void> {
  const parsed = parseCookieValue(cookieValue);
  if (!parsed) return;

  // Delete by parsed id without re-verifying HMAC: session ids are 256-bit
  // unguessable (randomBytes(32)), and the spec permits delete-by-id on valid
  // parses (malformed cookies fail at parse; HMAC re-verification could be
  // added as hardening if session ids ever risk exposure, e.g., server logs).
  await db.delete(sessions).where(eq(sessions.id, parsed.id));
}
