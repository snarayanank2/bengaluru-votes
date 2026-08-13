/**
 * The single OTP mechanism behind ALL authentication (citizen, curator,
 * admin — PRD §10 "One OTP mechanism for all roles") — architecture.md §7
 * "OTP request/verify" and §13 "OTP" (security review, decided 2026-07-17).
 * No passwords, no 2FA, ever.
 *
 * ============================================================================
 * COOLDOWN SEMANTICS — READ BEFORE CHANGING THIS FILE
 * ============================================================================
 * The per-destination cooldowns below (1/minute, 5/hour, a daily cap) exist
 * to stop SMS/WhatsApp/email pumping against a single victim contact — but
 * they are THEMSELVES a targeted-DoS vector: anyone can burn a *known*
 * curator or admin address's send budget just by requesting repeatedly.
 * Architecture §13's answer is that a cooldown denies fresh *sends*, never
 * *login*: hitting a cooldown returns `'already_sent'` (or `'cooldown_daily'`
 * for the daily cap) and the EARLIER CODE STAYS VALID, sitting in the real
 * destination's own inbox regardless of who triggered the cooldown. This
 * function must NEVER invalidate/consume/delete an existing unconsumed code
 * as a side effect of a cooldown check — it just refuses to mint a new one.
 * ============================================================================
 *
 * COOLDOWN ORDERING (checked in this order, first match wins):
 *   1. suppressions (hard stop — a prior bounce/complaint/STOP for this
 *      exact destination+channel; Task 52/53 populate this table, this
 *      module only reads it — an empty table is a no-op).
 *   2. 1/minute — any send in the trailing 60s -> 'already_sent'.
 *   3. 5/hour   — >=5 sends in the trailing 60 minutes -> 'already_sent'.
 *   4. daily cap — >=OTP_DESTINATION_DAILY_CAP sends in the trailing 24h
 *      -> 'cooldown_daily'.
 * Only once all four pass does this function touch the GLOBAL daily send
 * budget (`consumeBudget('otp_send', ...)`) — deliberately AFTER the
 * per-destination checks, so a destination sitting in cooldown never spends
 * a unit of the shared budget (architecture §13 "cost amplification").
 *
 * SEND-THEN-PERSIST: the code is generated and sent BEFORE the otp_codes
 * row is written. A send that fails (SendGrid error, or WhatsApp's expected
 * `not_configured` state — PRD §10, WhatsApp isn't onboarded yet) leaves NO
 * row behind: nothing was delivered anywhere, so there's no valid code to
 * protect, and leaving a phantom row would falsely occupy the caller's next
 * cooldown window.
 *
 * PEPPER: `codeHash = sha256(code + SESSION_SECRET)`. SESSION_SECRET
 * (src/lib/session.ts) is reused rather than provisioning a second secret —
 * documented there and here. A 6-digit code space is small, so the pepper
 * plus DB-only storage of the hash is what keeps a stolen `otp_codes` table
 * from being trivially crackable; it's a defense-in-depth measure, not the
 * primary control (5-attempt lock + 10-minute expiry are).
 */
import { randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { otpCodes, otpTestCodes, suppressions } from '../db/schema';
import { consumeBudget } from './budgets';
import { sendEmail } from './send/sendgrid';
import { sendWhatsAppTemplate } from './send/twilio';
import { SESSION_SECRET } from './session';

export type OtpChannel = 'email' | 'whatsapp';
export type OtpPurpose = 'auth' | 'add_contact';

export type RequestOtpResult =
  | 'sent'
  | 'already_sent'
  | 'cooldown_daily'
  | 'budget_exhausted'
  | 'suppressed'
  | 'send_failed';

export type VerifyOtpResult =
  | { ok: true; userId: number | null }
  | { ok: false; reason: 'expired' | 'invalid' | 'locked' };

/** architecture.md §13: "5 verify attempts per code, then the code is invalidated." */
const MAX_VERIFY_ATTEMPTS = 5;

/** architecture.md §13: "10-minute expiry". */
const CODE_TTL_MS = 10 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** architecture.md §13: "5/hour" per destination. */
export const OTP_HOURLY_LIMIT = 5;

/**
 * Per-destination daily cap (architecture.md §13: "a daily cap"). A rolling
 * 24h window, not a calendar day — consistent with the minute/hour windows
 * above and simpler to reason about than a UTC-midnight reset.
 */
export const OTP_DESTINATION_DAILY_CAP = 10;

/** Global daily send budget across every destination (architecture.md §13 "cost amplification"). */
export const OTP_DAILY_SEND_BUDGET = Number(process.env.OTP_DAILY_SEND_BUDGET ?? 5000);

const OTP_EMAIL_SUBJECT = 'Your Bengaluru Votes verification code';

function otpEmailHtml(code: string): string {
  return `<p>Your Bengaluru Votes verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`;
}

/** The approved WhatsApp OTP template SID (Twilio Content API) — unset until WhatsApp onboarding completes (PRD §10). */
const WHATSAPP_OTP_TEMPLATE_SID = process.env.TWILIO_OTP_TEMPLATE_SID ?? '';

/**
 * Normalizes a destination the same way for both `requestOtp` and
 * `verifyOtp`, so a lookup always matches what was stored regardless of
 * which `channel` value happened to be passed at request time. Email-shaped
 * (contains `@`) -> trimmed + lowercased; anything else (a phone number) ->
 * trimmed only (kept simple per the task brief; a future task may add
 * E.164 normalization).
 */
export function normalizeDestination(destination: string): string {
  const trimmed = destination.trim();
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
}

/** Zero-padded 6-digit numeric code from a CSPRNG — never Math.random. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode(code: string): string {
  return createHash('sha256').update(code + SESSION_SECRET).digest('hex');
}

/** Constant-time comparison of two sha256 hex digests (always equal length, so no length-mismatch branch needed). */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Requests a new OTP code for `destination` over `channel`, for `purpose`
 * ('auth' for login/registration; 'add_contact' when an authenticated user
 * is attaching a new contact to their account, with `userId` set). See the
 * module docstring for the full cooldown/budget/send ordering. Never
 * reveals whether `destination` belongs to a known account — this function
 * doesn't query `users` at all.
 */
export async function requestOtp(
  destinationRaw: string,
  channel: OtpChannel,
  purpose: OtpPurpose,
  userId?: number,
): Promise<RequestOtpResult> {
  const destination = normalizeDestination(destinationRaw);

  const suppressed = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.contact, destination), eq(suppressions.channel, channel)));
  if (suppressed.length > 0) return 'suppressed';

  const now = Date.now();
  const priorSends = await db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(eq(otpCodes.destination, destination));

  const withinMinute = priorSends.some((r) => now - r.createdAt.getTime() < MINUTE_MS);
  if (withinMinute) return 'already_sent';

  const withinHourCount = priorSends.filter((r) => now - r.createdAt.getTime() < HOUR_MS).length;
  if (withinHourCount >= OTP_HOURLY_LIMIT) return 'already_sent';

  const withinDayCount = priorSends.filter((r) => now - r.createdAt.getTime() < DAY_MS).length;
  if (withinDayCount >= OTP_DESTINATION_DAILY_CAP) return 'cooldown_daily';

  // Only past every per-destination gate does this touch the shared global budget.
  const withinBudget = await consumeBudget('otp_send', OTP_DAILY_SEND_BUDGET);
  if (!withinBudget) return 'budget_exhausted';

  const code = generateCode();

  let sendOk: boolean;
  if (channel === 'email') {
    const result = await sendEmail(destination, OTP_EMAIL_SUBJECT, otpEmailHtml(code));
    sendOk = result.ok;
  } else {
    const result = await sendWhatsAppTemplate(destination, WHATSAPP_OTP_TEMPLATE_SID, { '1': code });
    // 'not_configured' is the expected state until WhatsApp onboarding
    // completes (PRD §10) — surfaced as 'send_failed' so the endpoint can
    // tell the caller to use email instead.
    sendOk = result.ok && result.status === 'sent';
  }
  if (!sendOk) return 'send_failed';

  // TEST ONLY — OTP_TEST_SINK must NEVER be set in production (or staging).
  // It exists solely so the Playwright e2e suite (Task 64), which drives the
  // app through a real browser talking to a SEPARATE server process, can
  // read the plaintext code a request generated (it has no in-process
  // access to this function's return value). This block is a strict no-op
  // unless the env var is exactly the string 'true' — it does not alter the
  // hashed-storage write below or anything else about the real send path.
  if (process.env.OTP_TEST_SINK === 'true') {
    await db.insert(otpTestCodes).values({ destination, code });
  }

  await db.insert(otpCodes).values({
    destination,
    channel,
    purpose,
    userId: userId ?? null,
    codeHash: hashCode(code),
    attempts: 0,
    expiresAt: new Date(now + CODE_TTL_MS),
  });

  return 'sent';
}

/**
 * Verifies `code` for `destination`. Returns `{ok:true, userId}` where
 * `userId` is whatever was stored on the otp_codes row (set for
 * `add_contact`; typically `null` for `auth`, since a plain login doesn't
 * know the account until AFTER verification — the caller (an API endpoint)
 * resolves the account by looking up `users` by the now-verified
 * destination; `null` there means "new contact, take the registration
 * path"). Never throws on a bad/absent/expired/locked code — those are
 * ordinary `{ok:false, reason}` results.
 *
 * `opts.consume` (default `true`): whether a CORRECT match marks the code
 * consumed. The Register/Login flow (Task 27, `src/lib/auth-flow.ts`'s
 * `resolveOrRegister`) calls this twice for an unknown contact: once to
 * decide known-vs-unknown (`consume: false` — a "peek", since the client's
 * confirm step is about to resubmit the exact same code moments later with
 * the registration payload) and once to actually finish the flow
 * (`consume: true`). A WRONG code always increments `attempts` regardless
 * of `consume` — that counter protects against guessing, not replay, and
 * must advance on every peek exactly like a real attempt.
 */
export async function verifyOtp(
  destinationRaw: string,
  code: string,
  opts?: { consume?: boolean },
): Promise<VerifyOtpResult> {
  const consume = opts?.consume ?? true;
  const destination = normalizeDestination(destinationRaw);

  const [row] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.destination, destination), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!row) return { ok: false, reason: 'invalid' };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  if (row.attempts >= MAX_VERIFY_ATTEMPTS) return { ok: false, reason: 'locked' };

  const matches = hashesMatch(hashCode(code), row.codeHash);

  if (!matches) {
    const newAttempts = row.attempts + 1;
    await db.update(otpCodes).set({ attempts: newAttempts }).where(eq(otpCodes.id, row.id));
    return { ok: false, reason: newAttempts >= MAX_VERIFY_ATTEMPTS ? 'locked' : 'invalid' };
  }

  if (consume) {
    await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id));
  }
  return { ok: true, userId: row.userId ?? null };
}
