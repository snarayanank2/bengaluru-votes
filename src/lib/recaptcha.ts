/**
 * reCAPTCHA v3 server-side verification (PRD §5.13/§6.3; architecture.md §7
 * anonymous writes are protected by reCAPTCHA v3 — server-verified token,
 * action, and score. This is the ANTI-BOT protection for `/api/eoi` and
 * `/api/issue-votes`; the middleware's Origin/Sec-Fetch
 * check (src/middleware.ts) is the separate ANTI-CSRF layer that already
 * applies to /api/eoi like every other unsafe-method request.
 *
 * FAIL-CLOSED IN PRODUCTION, ACCEPT IN DEV/TEST WITHOUT A KEY: this repo's
 * dev/CI environment has no RECAPTCHA_SECRET_KEY configured (Task 50 brief:
 * "ABSENT in this env"), and /api/eoi must still work end-to-end. So:
 *   - no secret + NODE_ENV !== 'production' -> ACCEPT (reason
 *     'no_secret_dev'). This is what lets local dev and CI exercise the EOI
 *     form/route without ever calling Google.
 *   - no secret + NODE_ENV === 'production' -> REJECT (reason
 *     'misconfigured'), logged loudly. A live production deployment with no
 *     secret configured would mean the anonymous EOI form has NO bot
 *     protection at all — worse than rejecting submissions until the key is
 *     set, so this fails closed rather than silently accepting everything.
 *
 * INJECTABLE VERIFIER (`opts.verifier`): replaces the real network call to
 * Google's siteverify endpoint entirely. Tests always pass one — no real
 * Google call, no key needed in CI. Production/dev leave it undefined and
 * get the real `callSiteverify` below.
 */
import { logEvent } from './log';

export interface RecaptchaVerifyResult {
  success: boolean;
  score: number;
  action?: string;
}

/** Injectable transport — swapped out entirely in tests so no real network call to Google is ever made. */
export type RecaptchaVerifier = (token: string, secret: string) => Promise<RecaptchaVerifyResult>;

export interface VerifyRecaptchaOptions {
  /** Defaults to `process.env.RECAPTCHA_SECRET_KEY`. */
  secret?: string;
  /** Minimum acceptable v3 score, inclusive. Defaults to 0.5. */
  minScore?: number;
  /** Defaults to the real Google siteverify call. Tests always override this. */
  verifier?: RecaptchaVerifier;
  /** Require the token to have been minted for this v3 action. */
  expectedAction?: string;
}

export interface VerifyRecaptchaResult {
  ok: boolean;
  score?: number;
  reason?: string;
}

const SITEVERIFY_ENDPOINT = 'https://www.google.com/recaptcha/api/siteverify';
const DEFAULT_MIN_SCORE = 0.5;

/** The real verifier: POSTs to Google's siteverify endpoint. Never exercised by tests — always swapped via opts.verifier. */
async function callSiteverify(token: string, secret: string): Promise<RecaptchaVerifyResult> {
  const body = new URLSearchParams({ secret, response: token });
  const res = await fetch(SITEVERIFY_ENDPOINT, { method: 'POST', body });
  const data = (await res.json()) as { success?: boolean; score?: number; action?: string };
  return {
    success: data.success === true,
    score: typeof data.score === 'number' ? data.score : 0,
    action: data.action,
  };
}

/**
 * Server-verifies a reCAPTCHA v3 token: no secret configured -> dev-accept /
 * prod-fail-closed (see module docstring); otherwise calls `opts.verifier`
 * (or the real Google siteverify call) and requires BOTH `success === true`
 * AND `score >= minScore`.
 */
export async function verifyRecaptcha(token: string, opts: VerifyRecaptchaOptions = {}): Promise<VerifyRecaptchaResult> {
  const secret = opts.secret ?? process.env.RECAPTCHA_SECRET_KEY;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;

  if (!secret) {
    if (process.env.ALLOW_INSECURE_LOCAL_RECAPTCHA === 'true' && /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/.test(process.env.SITE_ORIGIN ?? '')) {
      return { ok: true, reason: 'local_explicit_bypass' };
    }
    if (process.env.NODE_ENV === 'production') {
      logEvent('recaptcha_misconfigured', { reason: 'no_secret_key_in_production' });
      return { ok: false, reason: 'misconfigured' };
    }
    return { ok: true, reason: 'no_secret_dev' };
  }

  const verifier = opts.verifier ?? callSiteverify;
  const result = await verifier(token, secret);

  if (!result.success) {
    return { ok: false, score: result.score, reason: 'verification_failed' };
  }
  if (result.score < minScore) {
    return { ok: false, score: result.score, reason: 'low_score' };
  }
  if (opts.expectedAction && result.action !== opts.expectedAction) {
    return { ok: false, score: result.score, reason: 'wrong_action' };
  }
  return { ok: true, score: result.score };
}
