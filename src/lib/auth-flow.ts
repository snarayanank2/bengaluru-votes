/**
 * `resolveOrRegister` — the single account-resolution/registration helper
 * behind BOTH auth entry points (Task 27, PRD §10):
 *   - `POST /api/otp/verify` (src/pages/api/otp/verify.ts), used by the
 *     Register/Login modal (src/islands/RegisterLoginModal.ts).
 *   - `/login`'s no-JS server-rendered fallback (src/lib/login-flow.ts,
 *     src/pages/login.astro, src/pages/kn/login.astro).
 *
 * Extracted so the two paths can never diverge on the security-critical
 * bits: case-normalized destination lookup (Task 25 review Fix 1),
 * one-account-per-contact enforcement (a DB unique-index race, not
 * read-then-write app logic), and the exact consent-evidence fields PRD §10
 * requires on registration (`consentAt`, `consentVersion`,
 * `futureToolsOptIn`, `srcAttribution`).
 *
 * PEEK-THEN-CONSUME (Task 27): the Register/Login flow calls this function
 * TWICE for a brand-new contact — once with no `register` payload (to learn
 * the contact is unknown; the OTP code must be left valid for the very next
 * call, so `verifyOtp` isn't told to consume it yet) and once moments later
 * with the `register` payload, reusing the SAME code. `consume` is only
 * `true` when this call fully resolves the flow: a KNOWN contact (login,
 * right here) or an UNKNOWN contact WITH a `register` payload (registration,
 * right here). See src/lib/otp.ts's `verifyOtp` docstring for the `consume`
 * option itself.
 */
import { eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { users, wards } from '../db/schema';
import { localePath, type Lang } from '../i18n';
import { captureException } from './logger';
import { isUniqueViolation } from './db-errors';
import { normalizeDestination, verifyOtp } from './otp';
import { sendToUser, type SendToUserUser } from './send/send';
import { createSession } from './session';
import { getKnownSetting } from './settings';

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://bengaluruvotes.opencity.in';

/** Human-readable language name for the W1 confirmation's `{{2}}` var (docs/messages.md §4: "language (English/Kannada)"). Same mapping src/lib/translate-runtime.ts uses. */
const LANGUAGE_DISPLAY_NAME: Record<Lang, string> = { en: 'English', kn: 'Kannada' };

export interface RegisterPayload {
  wardId: number;
  language: 'en' | 'kn';
  futureTools: boolean;
}

export type ResolveOrRegisterResult =
  | { ok: false; reason: 'expired' | 'invalid' | 'locked' | 'account_banned' }
  | { ok: false; reason: 'registration_required' }
  | { ok: true; registered: boolean; setCookie: string };

/** Fallback only when `consent_wording_version` has never been set (should not happen past initial seed). */
const DEFAULT_CONSENT_VERSION = 'v1';

async function findUserByContact(destination: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(or(eq(users.email, destination), eq(users.phone, destination)));
  return row;
}

/**
 * Fires the W1 welcome / opt-in confirmation (docs/messages.md §4, PRD §10)
 * for a JUST-registered user. `calendar.ts` deliberately excludes W1 ("fires
 * from the registration flow, auth-flow.ts") — this is that fire.
 *
 * ERROR-ISOLATED: this is `await`ed inside a try/catch by the caller, and any
 * throw is swallowed+logged there — a W1 send failure MUST NEVER fail or roll
 * back the registration (the account is already committed by the time this
 * runs). `sendToUser` already owns channel eligibility, suppression,
 * send-once, and SENDS_DISABLED, so nothing here needs to reason about those.
 *
 * W1's required vars are the union of its email+whatsapp templates
 * (templates.ts): `ward`, `language`, `notificationsLink` — all sourced from
 * the new user's own committed row (home ward, saved language), never
 * invented.
 */
async function sendWelcomeMessage(user: {
  id: number;
  email: string | null;
  phone: string | null;
  language: Lang;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  homeWardId: number | null;
}): Promise<void> {
  if (user.homeWardId == null) return; // registration always sets a home ward; defensive
  const [ward] = await db
    .select({ nameEn: wards.nameEn, nameKn: wards.nameKn })
    .from(wards)
    .where(eq(wards.id, user.homeWardId));
  if (!ward) return; // FK guarantees the ward exists at registration; defensive

  const wardName = user.language === 'kn' ? ward.nameKn : ward.nameEn;
  const vars = {
    ward: wardName,
    language: LANGUAGE_DISPLAY_NAME[user.language],
    notificationsLink: SITE_ORIGIN + localePath(user.language, '/account/notifications'),
  };

  const sendUser: SendToUserUser = {
    id: user.id,
    email: user.email,
    phone: user.phone,
    language: user.language,
    emailEnabled: user.emailEnabled,
    whatsappEnabled: user.whatsappEnabled,
    homeWardId: user.homeWardId,
  };
  await sendToUser(sendUser, 'W1', vars, { wardId: user.homeWardId });
}

/**
 * Verifies `code` for `destinationRaw` and resolves the account: LOGIN for a
 * known contact, REGISTRATION for an unknown contact when `register` is
 * supplied, or `{ok:false, reason:'registration_required'}` for an unknown
 * contact with no `register` payload (the caller should re-prompt for
 * ward/language/consent and call again with the SAME code).
 */
export async function resolveOrRegister(
  destinationRaw: string,
  code: string,
  register?: RegisterPayload,
  srcAttribution?: string | null,
): Promise<ResolveOrRegisterResult> {
  const destination = normalizeDestination(destinationRaw);
  const existing = await findUserByContact(destination);

  const consume = Boolean(existing) || Boolean(register);
  const verified = await verifyOtp(destinationRaw, code, { consume });
  if (!verified.ok) return verified;

  if (existing) {
    if (existing.status !== 'active') {
      return { ok: false, reason: 'account_banned' };
    }
    const session = await createSession(existing.id);
    return { ok: true, registered: false, setCookie: session.setCookie };
  }

  if (!register) {
    return { ok: false, reason: 'registration_required' };
  }

  const consentVersion = (await getKnownSetting('consent_wording_version')) ?? DEFAULT_CONSENT_VERSION;
  const isEmail = destination.includes('@');

  try {
    const [created] = await db
      .insert(users)
      .values({
        email: isEmail ? destination : null,
        phone: isEmail ? null : destination,
        homeWardId: register.wardId,
        language: register.language,
        role: 'citizen',
        status: 'active',
        consentAt: new Date(),
        consentVersion,
        futureToolsOptIn: register.futureTools,
        srcAttribution: srcAttribution ?? null,
      })
      .returning();

    const session = await createSession(created!.id);

    // W1 welcome / opt-in confirmation — ONLY on the register path (never on
    // login of an existing contact). Error-isolated: a send failure must not
    // fail or roll back the just-committed registration. `sendToUser` handles
    // channel eligibility / suppression / send-once / SENDS_DISABLED itself.
    try {
      await sendWelcomeMessage(created!);
    } catch (sendErr) {
      // No PII — captureException scrubs, and we pass only the user id.
      captureException(sendErr, { event: 'w1_send_failed', userId: created!.id });
    }

    return { ok: true, registered: true, setCookie: session.setCookie };
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      // One-account-per-contact race: another request registered this exact
      // contact between our lookup above and this insert. Resolve as a
      // login for the winner rather than a duplicate or a 500.
      const winner = await findUserByContact(destination);
      if (winner) {
        if (winner.status !== 'active') {
          return { ok: false, reason: 'account_banned' };
        }
        const session = await createSession(winner.id);
        return { ok: true, registered: false, setCookie: session.setCookie };
      }
    }
    throw err;
  }
}
