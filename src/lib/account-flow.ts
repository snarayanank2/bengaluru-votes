/**
 * Business logic behind the three registered-citizen account pages (Task
 * 29): `/account`,
 * `/account/notifications`, `/account/submissions`. Mirrors the shape of
 * `src/lib/login-flow.ts` — this module owns state-loading/mutation, the
 * page route twins (src/pages/account/*, src/pages/kn/account/*) own the
 * HTTP concerns a plain module cannot (redirects, Set-Cookie, no-store).
 *
 * All three pages require a session — src/middleware.ts already guards
 * every `/account/*` route (redirect to `/login` when absent) and enforces
 * the synchronizer CSRF token on every unsafe method here. Nothing in this
 * module re-checks either; it trusts the `userId` it's given.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { flagItems, flagSubmissions, users, wards, type flagStatusEnum } from '../db/schema';
import { isUniqueViolation } from './db-errors';
import { normalizeDestination, requestOtp, verifyOtp, type OtpChannel } from './otp';
import { retireActiveSet } from './votes';

export interface AccountUser {
  id: number;
  email: string | null;
  phone: string | null;
  language: 'en' | 'kn';
  homeWardId: number | null;
}

export interface WardInfo {
  id: number;
  nameEn: string;
  nameKn: string;
}

export interface AccountMessage {
  kind: 'notice' | 'error';
  key: string;
}

export interface AccountRenderState {
  user: AccountUser;
  ward: WardInfo | null;
  message?: AccountMessage;
  /**
   * Set only mid-flow of adding/changing a contact (after step 1's OTP
   * request) — the page renders the code-entry form instead of the "add a
   * contact" form while this is present.
   */
  contactPending?: { destination: string; channel: OtpChannel };
}

export async function loadAccountUser(userId: number): Promise<AccountUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      phone: users.phone,
      language: users.language,
      homeWardId: users.homeWardId,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

async function loadWard(wardId: number | null): Promise<WardInfo | null> {
  if (wardId == null) return null;
  const [row] = await db
    .select({ id: wards.id, nameEn: wards.nameEn, nameKn: wards.nameKn })
    .from(wards)
    .where(eq(wards.id, wardId));
  return row ?? null;
}

/** GET-time state for `/account` — `null` only in the defensive case where `userId` no longer resolves to a user row (the page redirects to `/login` in that case). */
export async function loadAccountState(userId: number): Promise<AccountRenderState | null> {
  const user = await loadAccountUser(userId);
  if (!user) return null;
  const ward = await loadWard(user.homeWardId);
  return { user, ward };
}

/** Reloads fresh state after a mutation, folding in the outcome `message`/`contactPending`. Throws if `userId` no longer resolves — the page-level guard already ensured it did at the top of the request. */
async function stateFor(
  userId: number,
  message?: AccountMessage,
  contactPending?: AccountRenderState['contactPending'],
): Promise<AccountRenderState> {
  const state = await loadAccountState(userId);
  if (!state) {
    throw new Error(`account-flow: no user with id ${userId} (session should have been invalidated already)`);
  }
  return { ...state, message, contactPending };
}

export type AccountPostOutcome = { kind: 'signout' } | { kind: 'state'; state: AccountRenderState };

async function handleLanguage(userId: number, form: FormData): Promise<AccountRenderState> {
  const language = String(form.get('language') ?? '') === 'kn' ? 'kn' : 'en';
  await db.update(users).set({ language }).where(eq(users.id, userId));
  return stateFor(userId, { kind: 'notice', key: 'account.language.success' });
}

async function handleWard(userId: number, form: FormData): Promise<AccountRenderState> {
  const wardIdRaw = Number(form.get('wardId'));
  if (!Number.isInteger(wardIdRaw)) {
    return stateFor(userId, { kind: 'error', key: 'account.ward.error.invalid' });
  }

  const ward = await loadWard(wardIdRaw);
  if (!ward) {
    return stateFor(userId, { kind: 'error', key: 'account.ward.error.notFound' });
  }

  const current = await loadAccountUser(userId);
  if (current?.homeWardId === wardIdRaw) {
    // Not an actual change — nothing to retire (retirement only fires on a
    // real ward change).
    return stateFor(userId, { kind: 'notice', key: 'account.ward.success' });
  }

  // Changing home ward retires the previous ward's vote-set —
  // both writes commit atomically, or neither does.
  await db.transaction(async (tx) => {
    await tx.update(users).set({ homeWardId: wardIdRaw }).where(eq(users.id, userId));
    await retireActiveSet(userId, tx);
  });

  return stateFor(userId, { kind: 'notice', key: 'account.ward.successRetired' });
}

async function handleContactStep1(userId: number, form: FormData): Promise<AccountRenderState> {
  const raw = String(form.get('destination') ?? '').trim();
  if (!raw) {
    return stateFor(userId, { kind: 'error', key: 'account.contact.error.required' });
  }

  const destination = normalizeDestination(raw);
  const channel: OtpChannel = destination.includes('@') ? 'email' : 'whatsapp';
  const status = await requestOtp(destination, channel, 'add_contact', userId);

  // Same non-disclosure shape as /login's step 1 (src/lib/login-flow.ts):
  // every status except a WhatsApp send failure advances to the code-entry
  // step — a cooldown/budget/suppression state isn't something the visitor
  // can act on differently, and a WhatsApp failure specifically needs to
  // nudge toward email since there is no code to enter otherwise.
  if (channel === 'whatsapp' && status === 'send_failed') {
    return stateFor(userId, { kind: 'error', key: 'account.contact.error.whatsappNudge' });
  }

  return stateFor(userId, { kind: 'notice', key: 'account.contact.step1.sent' }, { destination, channel });
}

async function handleContactStep2(userId: number, form: FormData): Promise<AccountRenderState> {
  // NORMALIZE before verifying AND before storing (final-review Fix 3): OTP
  // lookup normalizes (lower-cases email), so `users.email` must be stored in
  // the SAME normalized form — otherwise a `Foo@Bar.COM` here stores mixed
  // case while a later normalized login for `foo@bar.com` won't match it,
  // creating a duplicate account and breaking one-account-per-contact.
  const destination = normalizeDestination(String(form.get('destination') ?? ''));
  const channel: OtpChannel = String(form.get('channel') ?? 'email') === 'whatsapp' ? 'whatsapp' : 'email';
  const code = String(form.get('code') ?? '').trim();

  const verified = await verifyOtp(destination, code);
  if (!verified.ok) {
    return stateFor(userId, { kind: 'error', key: `account.contact.error.${verified.reason}` }, { destination, channel });
  }
  // Defensive: the otp_codes row's userId (set by requestOtp's `add_contact`
  // path) must match the session doing the verifying — a mismatch should
  // not be reachable in practice (the destination/channel/code all came
  // from this same session's own step-1 render) but is treated as an
  // invalid code rather than silently attached to the wrong account.
  if (verified.userId !== userId) {
    return stateFor(userId, { kind: 'error', key: 'account.contact.error.invalid' }, { destination, channel });
  }

  const isEmail = destination.includes('@');
  try {
    await db
      .update(users)
      .set(isEmail ? { email: destination } : { phone: destination })
      .where(eq(users.id, userId));
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      // One-account-per-contact — this exact contact already
      // belongs to a different user row.
      return stateFor(userId, { kind: 'error', key: 'account.contact.error.taken' }, { destination, channel });
    }
    throw err;
  }

  return stateFor(userId, { kind: 'notice', key: 'account.contact.success' });
}

/** Dispatches a `/account` POST by its hidden `action` field. */
export async function handleAccountPost(userId: number, form: FormData): Promise<AccountPostOutcome> {
  const action = String(form.get('action') ?? '');

  switch (action) {
    case 'signout':
      return { kind: 'signout' };
    case 'language':
      return { kind: 'state', state: await handleLanguage(userId, form) };
    case 'ward':
      return { kind: 'state', state: await handleWard(userId, form) };
    case 'contact_step1':
      return { kind: 'state', state: await handleContactStep1(userId, form) };
    case 'contact_step2':
      return { kind: 'state', state: await handleContactStep2(userId, form) };
    default:
      return { kind: 'state', state: await stateFor(userId, { kind: 'error', key: 'account.error.unknownAction' }) };
  }
}

// ---------------------------------------------------------------------------
// /account/notifications — channel toggles ONLY (no per-topic).
// ---------------------------------------------------------------------------

export interface NotificationsState {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
}

export async function loadNotificationsState(userId: number): Promise<NotificationsState> {
  const [row] = await db
    .select({ emailEnabled: users.emailEnabled, whatsappEnabled: users.whatsappEnabled })
    .from(users)
    .where(eq(users.id, userId));
  return { emailEnabled: row?.emailEnabled ?? true, whatsappEnabled: row?.whatsappEnabled ?? true };
}

/** Checkbox semantics: an unchecked box is simply absent from FormData — `!= null` is the presence check, same pattern as `auth.step3.futureTools` (src/lib/login-flow.ts). */
export async function handleNotificationsPost(userId: number, form: FormData): Promise<void> {
  const emailEnabled = form.get('emailEnabled') != null;
  const whatsappEnabled = form.get('whatsappEnabled') != null;
  await db.update(users).set({ emailEnabled, whatsappEnabled }).where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// /account/submissions — the citizen's own flags, read-only.
// ---------------------------------------------------------------------------

export interface SubmissionRow {
  id: number;
  detail: string;
  suggestedValue: string | null;
  sourceUrl: string | null;
  createdAt: Date;
  status: (typeof flagStatusEnum.enumValues)[number];
  resolutionReason: string | null;
  targetRef: string;
}

/**
 * The user's flag submissions, newest first, each joined to its (possibly
 * shared/collapsed) `flag_items` row for the current
 * status/resolutionReason. Two submissions that were deduped into the same
 * `flag_items` row (the dedupe unique index is `(targetRef, status)`) both
 * read the SAME status/resolutionReason here — there is nothing this query
 * needs to do specially for that case, since it's simply reading the one
 * shared parent row twice.
 */
export async function loadSubmissions(userId: number): Promise<SubmissionRow[]> {
  return db
    .select({
      id: flagSubmissions.id,
      detail: flagSubmissions.detail,
      suggestedValue: flagSubmissions.suggestedValue,
      sourceUrl: flagSubmissions.sourceUrl,
      createdAt: flagSubmissions.createdAt,
      status: sql<SubmissionRow['status']>`case when ${flagSubmissions.isSpam} then 'rejected'::flag_status else ${flagItems.status} end`,
      resolutionReason: sql<string | null>`case when ${flagSubmissions.isSpam} then null else ${flagItems.resolutionReason} end`,
      targetRef: flagItems.targetRef,
    })
    .from(flagSubmissions)
    .innerJoin(flagItems, eq(flagSubmissions.flagItemId, flagItems.id))
    .where(eq(flagSubmissions.userId, userId))
    .orderBy(desc(flagSubmissions.createdAt));
}
