/**
 * `/account`, `/account/notifications`, `/account/submissions` (Task 29,
 * information-architecture.md §4.1/§4.2/§4.3). Drives every request through
 * the REAL middleware (src/middleware.ts) composed with the real page twin
 * via Astro's container API — the same composition production uses — so
 * this suite can assert the actual session-guard/CSRF behavior end to end,
 * not just that a form happens to render a token. Only the OTP transports
 * (SendGrid/Twilio) are mocked, same technique as tests/routes/login.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';

vi.mock('../../src/lib/send/sendgrid', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../src/lib/send/twilio', () => ({ sendWhatsAppTemplate: vi.fn(async () => ({ ok: true, status: 'sent' })) }));
// Stub the campaign send path so nothing this suite does writes campaign_sends
// rows (would FK-block fixture cleanup); this suite doesn't test sends.
vi.mock('../../src/lib/send/send', () => ({ sendToUser: vi.fn(async () => ({ results: [] })) }));

import { sendEmail } from '../../src/lib/send/sendgrid';

import AccountEn from '../../src/pages/account/index.astro';
import AccountKn from '../../src/pages/kn/account/index.astro';
import AccountNotificationsEn from '../../src/pages/account/notifications.astro';
import AccountNotificationsKn from '../../src/pages/kn/account/notifications.astro';
import AccountSubmissionsEn from '../../src/pages/account/submissions.astro';
import AccountSubmissionsKn from '../../src/pages/kn/account/submissions.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. CI always sets this; for local runs export ' +
      'DATABASE_URL=postgres://postgres@localhost:54329/bv_test (see task brief).',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const SITE_URL = new URL(SITE_ORIGIN);

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward ids (task-29 brief) — other route suites own
// 94xxx-98xxx/99001/99101/99102 (see tests/routes/me.test.ts's comment);
// this suite owns 99201/99202.
const WARD_A = {
  id: 99201,
  nameEn: 'Account Route Test Ward A',
  nameKn: 'ಖಾತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'account-route-test-ward-a',
};
const WARD_B = {
  id: 99202,
  nameEn: 'Account Route Test Ward B',
  nameKn: 'ಖಾತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಬಿ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'account-route-test-ward-b',
};

const EMAILS = {
  language: 'account-route-language@example.com',
  ward: 'account-route-ward@example.com',
  contact: 'account-route-contact@example.com',
  contactNew: 'account-route-contact-new-render@example.com',
  contactNewAttach: 'account-route-contact-new-attach@example.com',
  taken: 'account-route-taken@example.com',
  // Final-review Fix 3: a mixed-case contact must be STORED normalized
  // (lowercased). Only the normalized form is a fixture email (that's what
  // ends up in users.email / otp_codes.destination and needs cleanup).
  contactMixedNormalized: 'account-route-mixed@example.com',
  notifications: 'account-route-notifications@example.com',
  submissions: 'account-route-submissions@example.com',
  csrf: 'account-route-csrf@example.com',
};
const FIXTURE_EMAILS = Object.values(EMAILS);

/** Strips container-API debug attributes and collapses whitespace (see tests/routes/login.test.ts). */
function normalize(html: string): string {
  return html
    .replace(/\s+data-astro-cid-\w+/g, '')
    .replace(/\s+data-astro-(?:source-file|source-loc)="[^"]*"/g, '')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+/g, ' ');
}

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

const ACCOUNT_TWINS = { en: AccountEn, kn: AccountKn };
const NOTIFICATIONS_TWINS = { en: AccountNotificationsEn, kn: AccountNotificationsKn };
const SUBMISSIONS_TWINS = { en: AccountSubmissionsEn, kn: AccountSubmissionsKn };

interface RunOptions {
  method?: 'GET' | 'POST';
  cookieValue?: string;
  fields?: Record<string, string>;
  secFetchSite?: string | null;
}

/**
 * Drives a request through the REAL middleware (src/middleware.ts) and then
 * the real page twin — the same composition production uses: middleware
 * populates locals.session/csrfToken/lang, then `next()` renders the page
 * against that same `locals` object and the same `Request` (so the page's
 * own `Astro.cookies.get(...)` — used by the sign-out flow — reads the real
 * Cookie header, not a stub).
 */
async function run(
  twins: Record<Lang, unknown>,
  lang: Lang,
  routePath: string,
  opts: RunOptions = {},
): Promise<Response> {
  const { method = 'GET', cookieValue, fields, secFetchSite = 'same-origin' } = opts;
  const path = localePath(lang, routePath);
  const url = new URL(path, SITE_URL);

  const headers = new Headers();
  if (cookieValue) headers.set('cookie', `${SESSION_COOKIE}=${cookieValue}`);
  if (fields) headers.set('content-type', 'application/x-www-form-urlencoded');
  if (secFetchSite) headers.set('sec-fetch-site', secFetchSite);

  const body = fields ? new URLSearchParams(fields).toString() : undefined;
  const request = new Request(url, { method, headers, body });

  const cookiesStub = {
    get: (name: string) => (name === SESSION_COOKIE && cookieValue ? { value: cookieValue } : undefined),
  };
  const locals: Record<string, unknown> = {};
  const ctx = { request, url, site: SITE_URL, cookies: cookiesStub, locals } as any;

  const container = await makeContainer();
  const next = async () =>
    container.renderToResponse(twins[lang] as any, {
      partial: false,
      request,
      locals: locals as unknown as App.Locals,
    });

  return (await onRequest(ctx, next)) as Response;
}

async function sessionFor(userId: number): Promise<{ cookieValue: string; token: string }> {
  const { id, cookieValue } = await createSession(userId);
  return { cookieValue, token: issueCsrfToken(id) };
}

/** Reads the plaintext 6-digit code back out of the mocked "sent" email body for `destination`. */
function getOtpCode(destination: string): string {
  const calls = vi.mocked(sendEmail).mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const [to, , html] = calls[i]!;
    if (to === destination) {
      const match = /(\d{6})/.exec(html as string);
      if (match) return match[1]!;
    }
  }
  throw new Error(`no OTP email found for ${destination}`);
}

async function upsertUser(
  email: string,
  extra: Partial<typeof schema.users.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(schema.users)
    .values({ email, role: 'citizen', status: 'active', ...extra })
    .onConflictDoUpdate({ target: schema.users.email, set: { role: 'citizen', status: 'active', ...extra } })
    .returning({ id: schema.users.id });
  return row!.id;
}

async function resetFixtures(): Promise<void> {
  const fixtureUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.email, FIXTURE_EMAILS));
  const ids = fixtureUsers.map((u) => u.id);
  if (ids.length > 0) {
    await db.delete(schema.flagSubmissions).where(inArray(schema.flagSubmissions.userId, ids));
    await db.delete(schema.issueVoteSelections).where(
      inArray(
        schema.issueVoteSelections.setId,
        db.select({ id: schema.issueVoteSets.id }).from(schema.issueVoteSets).where(inArray(schema.issueVoteSets.userId, ids)),
      ),
    );
    await db.delete(schema.issueVoteSets).where(inArray(schema.issueVoteSets.userId, ids));
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
  }
  await db.delete(schema.flagItems).where(inArray(schema.flagItems.wardId, [WARD_A.id, WARD_B.id]));
  await db.delete(schema.otpCodes).where(inArray(schema.otpCodes.destination, FIXTURE_EMAILS));
  await db.delete(schema.users).where(inArray(schema.users.email, FIXTURE_EMAILS));
}

describe('/account, /account/notifications, /account/submissions (Task 29) — IA §4.1/§4.2/§4.3', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD_A).onConflictDoUpdate({ target: schema.wards.id, set: WARD_A });
    await db.insert(schema.wards).values(WARD_B).onConflictDoUpdate({ target: schema.wards.id, set: WARD_B });
    await resetFixtures();
  });

  afterAll(async () => {
    await resetFixtures();
    await client.end();
  });

  beforeEach(async () => {
    vi.mocked(sendEmail).mockClear();
  });

  describe('session guard', () => {
    it('GET /account with no session -> 302 redirect to /login?next=', async () => {
      const res = await run(ACCOUNT_TWINS, 'en', '/account');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/account')}`);
    });

    it('GET /account authed -> 200, renders the account heading', async () => {
      const userId = await upsertUser(EMAILS.language, { homeWardId: WARD_A.id });
      const { cookieValue } = await sessionFor(userId);

      const res = await run(ACCOUNT_TWINS, 'en', '/account', { cookieValue });
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain(t('en', 'account.heading'));
      expect(html).toContain('name="robots" content="noindex"');
    });
  });

  describe('language preference (PRD §8)', () => {
    it('authed POST with a valid csrf token + language=kn updates users.language', async () => {
      const userId = await upsertUser(EMAILS.language, { homeWardId: WARD_A.id, language: 'en' });
      const { cookieValue, token } = await sessionFor(userId);

      const res = await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: { action: 'language', language: 'kn', [CSRF_FIELD_NAME]: token },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');

      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(row!.language).toBe('kn');
    });
  });

  describe('home ward change retires the previous ward vote-set (PRD §5.5)', () => {
    it('POST ward change: users.homeWardId updated AND the old ward active vote-set is retired, atomically', async () => {
      const userId = await upsertUser(EMAILS.ward, { homeWardId: WARD_A.id, language: 'en' });
      const { cookieValue, token } = await sessionFor(userId);

      const [set] = await db
        .insert(schema.issueVoteSets)
        .values({ userId, wardId: WARD_A.id, active: true })
        .returning({ id: schema.issueVoteSets.id });

      const res = await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: { action: 'ward', wardId: String(WARD_B.id), [CSRF_FIELD_NAME]: token },
      });

      expect(res.status).toBe(200);

      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(user!.homeWardId).toBe(WARD_B.id);

      const [retiredSet] = await db.select().from(schema.issueVoteSets).where(eq(schema.issueVoteSets.id, set!.id));
      expect(retiredSet!.active).toBe(false);
    });
  });

  describe('contact add/change — OTP-verified (PRD §9/§10)', () => {
    it('step 1 requests an OTP (sendEmail called) and renders the code-entry step', async () => {
      const userId = await upsertUser(EMAILS.contact, { homeWardId: WARD_A.id });
      const { cookieValue, token } = await sessionFor(userId);

      const res = await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: { action: 'contact_step1', destination: EMAILS.contactNew, [CSRF_FIELD_NAME]: token },
      });

      expect(res.status).toBe(200);
      expect(sendEmail).toHaveBeenCalled();
      const html = normalize(await res.text());
      expect(html).toContain('name="code"');
      expect(html).toContain(`name="destination" value="${EMAILS.contactNew}"`);
    });

    it('step 2 with the correct code attaches the new contact to users.email', async () => {
      const userId = await upsertUser(EMAILS.contact, { homeWardId: WARD_A.id });
      const { cookieValue, token } = await sessionFor(userId);

      await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: { action: 'contact_step1', destination: EMAILS.contactNewAttach, [CSRF_FIELD_NAME]: token },
      });
      const code = getOtpCode(EMAILS.contactNewAttach);

      const res = await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: {
          action: 'contact_step2',
          destination: EMAILS.contactNewAttach,
          channel: 'email',
          code,
          [CSRF_FIELD_NAME]: token,
        },
      });

      expect(res.status).toBe(200);
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(row!.email).toBe(EMAILS.contactNewAttach);
    });

    it('a MIXED-CASE contact is stored NORMALIZED (lowercased), so a normalized login resolves to the SAME account — no duplicate (Fix 3)', async () => {
      const MIXED = 'Account-Route-Mixed@Example.COM';
      const normalized = EMAILS.contactMixedNormalized; // 'account-route-mixed@example.com'

      const userId = await upsertUser(EMAILS.contact, { homeWardId: WARD_A.id });
      const { cookieValue, token } = await sessionFor(userId);

      // Step 1 with the MIXED-CASE destination — requestOtp normalizes, so the
      // OTP email goes to the lowercased address.
      await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: { action: 'contact_step1', destination: MIXED, [CSRF_FIELD_NAME]: token },
      });
      const code = getOtpCode(normalized);

      // Step 2 with the MIXED-CASE destination + the code.
      const res = await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: {
          action: 'contact_step2',
          destination: MIXED,
          channel: 'email',
          code,
          [CSRF_FIELD_NAME]: token,
        },
      });
      expect(res.status).toBe(200);

      // Stored value is the NORMALIZED (lowercase) email — the exact key a
      // later normalized login (`findUserByContact` -> `eq(users.email, ...)`)
      // queries by, so it resolves to THIS user rather than registering a
      // duplicate. Before the fix, users.email held 'Account-Route-Mixed@...'
      // and this normalized lookup would miss.
      const byNormalized = await db.select().from(schema.users).where(eq(schema.users.email, normalized));
      expect(byNormalized).toHaveLength(1);
      expect(byNormalized[0]!.id).toBe(userId);
      expect(byNormalized[0]!.email).toBe(normalized);
    });

    it('a contact already registered to ANOTHER account -> error, not attached', async () => {
      await upsertUser(EMAILS.taken, {}); // pre-existing account already owns this contact
      const userId = await upsertUser(EMAILS.contact, { homeWardId: WARD_A.id });
      const { cookieValue, token } = await sessionFor(userId);

      await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: { action: 'contact_step1', destination: EMAILS.taken, [CSRF_FIELD_NAME]: token },
      });
      const code = getOtpCode(EMAILS.taken);

      const res = await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: {
          action: 'contact_step2',
          destination: EMAILS.taken,
          channel: 'email',
          code,
          [CSRF_FIELD_NAME]: token,
        },
      });

      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain(t('en', 'account.contact.error.taken'));

      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(row!.email).toBe(EMAILS.contact); // unchanged — never attached
    });
  });

  describe('/account/notifications — channel toggles only (PRD §9.3)', () => {
    it('POST emailEnabled=false, whatsappEnabled=on -> persisted independently', async () => {
      const userId = await upsertUser(EMAILS.notifications, {
        homeWardId: WARD_A.id,
        emailEnabled: true,
        whatsappEnabled: true,
      });
      const { cookieValue, token } = await sessionFor(userId);

      // emailEnabled omitted entirely (unchecked checkbox never submits) -> false.
      const res = await run(NOTIFICATIONS_TWINS, 'en', '/account/notifications', {
        method: 'POST',
        cookieValue,
        fields: { whatsappEnabled: 'on', [CSRF_FIELD_NAME]: token },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');

      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(row!.emailEnabled).toBe(false);
      expect(row!.whatsappEnabled).toBe(true);
    });

    it('POST both toggles off -> both persisted false', async () => {
      const userId = await upsertUser(EMAILS.notifications, {
        homeWardId: WARD_A.id,
        emailEnabled: true,
        whatsappEnabled: true,
      });
      const { cookieValue, token } = await sessionFor(userId);

      const res = await run(NOTIFICATIONS_TWINS, 'en', '/account/notifications', {
        method: 'POST',
        cookieValue,
        fields: { [CSRF_FIELD_NAME]: token },
      });

      expect(res.status).toBe(200);
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(row!.emailEnabled).toBe(false);
      expect(row!.whatsappEnabled).toBe(false);
    });
  });

  describe('/account/submissions — status + shared outcome (PRD §6.2/§6.3)', () => {
    it('shows a pending flag and an accepted (collapsed) flag with the shared resolution reason', async () => {
      const userId = await upsertUser(EMAILS.submissions, { homeWardId: WARD_A.id });
      const { cookieValue } = await sessionFor(userId);

      const [pendingItem] = await db
        .insert(schema.flagItems)
        .values({
          wardId: WARD_A.id,
          targetType: 'ward_field',
          targetRef: 'ward:99201:account-route-test-pending',
          status: 'pending',
        })
        .returning({ id: schema.flagItems.id });
      await db.insert(schema.flagSubmissions).values({
        flagItemId: pendingItem!.id,
        userId,
        detail: 'Account route test pending detail',
      });

      const [acceptedItem] = await db
        .insert(schema.flagItems)
        .values({
          wardId: WARD_A.id,
          targetType: 'ward_field',
          targetRef: 'ward:99201:account-route-test-accepted',
          status: 'accepted',
          resolutionReason: 'Account route test shared resolution reason',
        })
        .returning({ id: schema.flagItems.id });
      // Two submissions collapsed into the SAME flag_items row (PRD §6.3).
      await db.insert(schema.flagSubmissions).values({
        flagItemId: acceptedItem!.id,
        userId,
        detail: 'Account route test accepted detail A',
      });
      await db.insert(schema.flagSubmissions).values({
        flagItemId: acceptedItem!.id,
        userId,
        detail: 'Account route test accepted detail B',
      });

      const res = await run(SUBMISSIONS_TWINS, 'en', '/account/submissions', { cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');

      const html = normalize(await res.text());
      expect(html).toContain('Account route test pending detail');
      expect(html).toContain('Account route test accepted detail A');
      expect(html).toContain('Account route test accepted detail B');
      expect(html).toContain(t('en', 'common.badge.flagPending'));
      expect(html).toContain(t('en', 'common.badge.flagAccepted'));

      // The shared resolution reason appears once per collapsed submission —
      // both accepted-item rows show the SAME reason text.
      const reasonOccurrences = html.split('Account route test shared resolution reason').length - 1;
      expect(reasonOccurrences).toBe(2);
    });
  });

  describe('CSRF (src/middleware.ts synchronizer token)', () => {
    it('POST /account without the csrf token -> 403', async () => {
      const userId = await upsertUser(EMAILS.csrf, { homeWardId: WARD_A.id, language: 'en' });
      const { cookieValue } = await sessionFor(userId);

      const res = await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: { action: 'language', language: 'kn' },
      });

      expect(res.status).toBe(403);

      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(row!.language).toBe('en'); // never applied
    });

    it('POST /account WITH the valid csrf token -> succeeds, no-store', async () => {
      const userId = await upsertUser(EMAILS.csrf, { homeWardId: WARD_A.id, language: 'en' });
      const { cookieValue, token } = await sessionFor(userId);

      const res = await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: { action: 'language', language: 'kn', [CSRF_FIELD_NAME]: token },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');

      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(row!.language).toBe('kn');
    });
  });

  describe('sign out', () => {
    it('POST action=signout -> 302 redirect to "/", clears the session cookie, destroys the session row', async () => {
      const userId = await upsertUser(EMAILS.csrf, { homeWardId: WARD_A.id });
      const { cookieValue, token } = await sessionFor(userId);

      const res = await run(ACCOUNT_TWINS, 'en', '/account', {
        method: 'POST',
        cookieValue,
        fields: { action: 'signout', [CSRF_FIELD_NAME]: token },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
      expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=;`);
      expect(res.headers.get('cache-control')).toBe('no-store');

      const sessionId = cookieValue.split('.')[0]!;
      const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
      expect(rows).toHaveLength(0);
    });
  });
});
