/**
 * Synchronizer CSRF tokens (architecture.md §7 "one middleware enforces
 * roles... server-rendered forms carry a synchronizer
 * CSRF token", §13 "CSRF"). `SameSite=Lax` plus the middleware's
 * Origin/Sec-Fetch-Site check (src/middleware.ts) are the first two layers;
 * this is the third, specifically for the no-JS server-rendered form paths
 * under `/account`, `/curator`, `/admin` — pages rendered for a signed-in
 * session embed `issueCsrfToken(sessionId)` in a hidden `csrf_token` field,
 * and the middleware checks it with `checkCsrfToken` on unsafe methods.
 *
 * ANONYMOUS mutating endpoints (the OTP request/verify JSON POSTs, and the
 * EOI form — CAPTCHA-protected, Task 50) have no session to bind a
 * synchronizer token to, so they are NOT covered here: they rely on the
 * Origin/Sec-Fetch-Site check alone (plus their own rate limits/CAPTCHA).
 * Synchronizer tokens only ever protect AUTHENTICATED server-rendered forms.
 *
 * TOKEN SHAPE: `issueCsrfToken(sessionId)` is
 * `HMAC-SHA256(sessionId, CSRF_SECRET)` (hex) where `CSRF_SECRET` is itself
 * derived from `SESSION_SECRET` (src/lib/session.ts) via a domain-separated
 * HMAC, rather than a second secret to provision/rotate. The token is
 * deterministic for a given session id (no per-form nonce, no storage): it
 * is valid for the lifetime of that session and stops working the moment
 * the session is destroyed (logout) or a new one is issued (re-login),
 * because a new session id changes the input, which is exactly the
 * invalidation semantics a synchronizer token needs to prevent CSRF.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SESSION_SECRET } from './session';

/** Domain-separated from SESSION_SECRET so a leaked CSRF token never reveals anything about session-cookie signing. */
const CSRF_SECRET = createHmac('sha256', SESSION_SECRET).update('csrf-token-v1').digest();

/** The hidden form field name pages under /account, /curator, /admin must embed this token as. */
export const CSRF_FIELD_NAME = 'csrf_token';

/** Issues the synchronizer token bound to `sessionId` (the raw `sessions.id` row id, NOT the full cookie value). */
export function issueCsrfToken(sessionId: string): string {
  return createHmac('sha256', CSRF_SECRET).update(sessionId).digest('hex');
}

/** Timing-safe check of a submitted token against the one `sessionId` should produce. Never throws. */
export function checkCsrfToken(sessionId: string, token: string | null | undefined): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;

  const expectedHex = issueCsrfToken(sessionId);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(token, 'hex');
  } catch {
    return false;
  }
  // A submitted token that isn't valid hex, or decodes to a different byte
  // length, must fail before timingSafeEqual (which throws on length
  // mismatch) — mirrors the same guard in src/lib/session.ts.
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
