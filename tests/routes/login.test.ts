/**
 * `/login`, `/kn/login` (Task 27) — the no-JS / deep-link fallback for the
 * Register/Login modal (src/islands/RegisterLoginModal.ts). Exercises the
 * full flow through the real page twins (src/pages/login.astro,
 * src/pages/kn/login.astro) against a real Postgres DB, with only the
 * OTP transports (SendGrid/Twilio) mocked — the plaintext code is read back
 * out of the mocked "sent" email body, same technique as
 * tests/unit/otp.test.ts / tests/unit/auth-flow.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';
import { SESSION_COOKIE } from '../../src/lib/session';

vi.mock('../../src/lib/send/sendgrid', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../src/lib/send/twilio', () => ({ sendWhatsAppTemplate: vi.fn(async () => ({ ok: true, status: 'sent' })) }));
// Registration fires the W1 welcome send (final-review Fix 2); this suite
// tests the /login route, not the send path — stub sendToUser so it writes no
// campaign_sends rows (which would otherwise FK-block fixture cleanup).
vi.mock('../../src/lib/send/send', () => ({ sendToUser: vi.fn(async () => ({ results: [] })) }));

import { sendEmail } from '../../src/lib/send/sendgrid';
import LoginEn from '../../src/pages/login.astro';
import LoginKn from '../../src/pages/kn/login.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward id — other route suites own 94001-97002/98001/98101.
const WARD = {
  id: 98201,
  nameEn: 'Login Route Test Ward',
  nameKn: 'ಲಾಗಿನ್ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'login-route-test-ward',
};

const KNOWN_EMAIL = 'login-route-known@example.com';
const NEW_EMAIL = 'login-route-new@example.com';
// See tests/routes/otp.test.ts's comment on this same constant:
// `app_settings.consent_wording_version` is a global singleton row shared
// across concurrently-run test files — every file that seeds it must use
// the SAME literal value.
const CONSENT_VERSION = 'shared-test-consent-wording-v1';
const FIXTURE_EMAILS = [KNOWN_EMAIL, NEW_EMAIL];

/** Strips container-API debug attributes and collapses whitespace (see tests/routes/home.test.ts). */
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

function twinFor(lang: Lang) {
  return lang === 'kn' ? LoginKn : LoginEn;
}

async function get(lang: Lang, query = ''): Promise<Response> {
  const container = await makeContainer();
  const path = localePath(lang, '/login') + query;
  return container.renderToResponse(twinFor(lang), { partial: false, request: new Request(`${SITE_ORIGIN}${path}`) });
}

async function post(lang: Lang, fields: Record<string, string>): Promise<Response> {
  const container = await makeContainer();
  const path = localePath(lang, '/login');
  const body = new URLSearchParams(fields).toString();
  return container.renderToResponse(twinFor(lang), {
    partial: false,
    request: new Request(`${SITE_ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
  });
}

async function resetFixtures(): Promise<void> {
  const fixtureUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.email, FIXTURE_EMAILS));
  const fixtureUserIds = fixtureUsers.map((u) => u.id);
  if (fixtureUserIds.length > 0) {
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, fixtureUserIds));
  }
  await db.delete(schema.users).where(inArray(schema.users.email, FIXTURE_EMAILS));
  await db.delete(schema.otpCodes).where(inArray(schema.otpCodes.destination, FIXTURE_EMAILS));
}

/** Drives a real step-1 submit and reads the plaintext code back out of the mocked "sent" email body. */
async function getRealCode(destination: string): Promise<string> {
  const before = vi.mocked(sendEmail).mock.calls.length;
  await post('en', { step: '1', destination, next: '/' });
  const call = vi.mocked(sendEmail).mock.calls[before];
  if (!call) throw new Error('sendEmail was not called');
  const html = call[2];
  const match = /(\d{6})/.exec(html);
  if (!match) throw new Error('no 6-digit code found in the fixture email body');
  return match[1]!;
}

describe('/login, /kn/login (Task 27) — IA §7.1, PRD §10', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
    await db
      .insert(schema.appSettings)
      .values({ key: 'consent_wording_version', value: CONSENT_VERSION })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: CONSENT_VERSION } });
  });

  afterAll(async () => {
    await resetFixtures();
    await client.end();
  });

  beforeEach(async () => {
    vi.mocked(sendEmail).mockClear();
    await resetFixtures();
  });

  describe('GET renders step 1', () => {
    it.each(['en', 'kn'] as const)('%s: renders the contact form, status 200, noindex', async (lang) => {
      const res = await get(lang);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain('name="destination"');
      expect(html).toContain('name="step" value="1"');
      expect(html).toContain('name="robots" content="noindex"');
    });
  });

  it('a POST with a contact triggers requestOtp (sendEmail called) and renders step 2, no-store', async () => {
    const res = await post('en', { step: '1', destination: NEW_EMAIL, next: '/' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const html = normalize(await res.text());
    expect(html).toContain('name="code"');
    expect(html).toContain('inputmode="numeric"');
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain(`name="destination" value="${NEW_EMAIL}"`);
  });

  it('a POST with a valid code for a KNOWN user -> 302 redirect to the validated next, with a bv_session Set-Cookie, no-store', async () => {
    await db.insert(schema.users).values({ email: KNOWN_EMAIL, homeWardId: WARD.id, role: 'citizen', status: 'active' });
    const code = await getRealCode(KNOWN_EMAIL);

    const res = await post('en', { step: '2', destination: KNOWN_EMAIL, channel: 'email', code, next: '/account' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/account');
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  describe('next open-redirect hardening (isSameOriginRelative)', () => {
    it('GET ?next=https://evil.example renders the hidden next field as "/" — sanitized before it reaches the form', async () => {
      const res = await get('en', '?next=https://evil.example');
      const html = normalize(await res.text());
      expect(html).toContain('name="next" value="/"');
    });

    it('a step-2 POST with a tampered absolute-URL next never redirects off-site — target is "/" regardless', async () => {
      await db.insert(schema.users).values({ email: KNOWN_EMAIL, homeWardId: WARD.id, role: 'citizen', status: 'active' });
      const code = await getRealCode(KNOWN_EMAIL);

      const res = await post('en', {
        step: '2',
        destination: KNOWN_EMAIL,
        channel: 'email',
        code,
        next: 'https://evil.example',
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
    });
  });

  it('a new contact + no register -> renders step 3 (confirm), carrying the same code forward', async () => {
    const code = await getRealCode(NEW_EMAIL);
    const res = await post('en', { step: '2', destination: NEW_EMAIL, channel: 'email', code, next: '/' });

    expect(res.status).toBe(200);
    const html = normalize(await res.text());
    expect(html).toContain('name="wardId"');
    expect(html).toContain('name="language"');
    expect(html).toContain(`name="code" value="${code}"`);

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, NEW_EMAIL));
    expect(rows).toHaveLength(0); // registration_required never creates a user
  });

  it('step 3 POST with ward + language + consent creates the user (consent fields set) + session + redirect', async () => {
    const code = await getRealCode(NEW_EMAIL);
    // Step 2 first (registration_required "peek") — the code must survive
    // this call unconsumed, exactly per src/lib/auth-flow.ts's contract.
    await post('en', { step: '2', destination: NEW_EMAIL, channel: 'email', code, next: '/' });

    const before = Date.now();
    const res = await post('en', {
      step: '3',
      destination: NEW_EMAIL,
      channel: 'email',
      code,
      wardId: String(WARD.id),
      language: 'kn',
      futureTools: 'on',
      next: '/',
    });
    const after = Date.now();

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const [row] = await db.select().from(schema.users).where(eq(schema.users.email, NEW_EMAIL));
    expect(row).toBeDefined();
    expect(row!.homeWardId).toBe(WARD.id);
    expect(row!.language).toBe('kn');
    expect(row!.role).toBe('citizen');
    expect(row!.status).toBe('active');
    expect(row!.futureToolsOptIn).toBe(true);
    expect(row!.consentVersion).toBe(CONSENT_VERSION);
    expect(row!.consentAt).not.toBeNull();
    expect(row!.consentAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(row!.consentAt!.getTime()).toBeLessThanOrEqual(after);
  });

  describe('step 3 markup: consent sentence, legal links, future-tools checkbox', () => {
    it('links to /terms and /privacy, includes the 18+ wording, and the future-tools checkbox is present/optional/unchecked by default', async () => {
      const code = await getRealCode(NEW_EMAIL);
      const res = await post('en', { step: '2', destination: NEW_EMAIL, channel: 'email', code, next: '/' });
      const html = normalize(await res.text());

      expect(html).toContain('href="/terms"');
      expect(html).toContain('href="/privacy"');
      expect(html).toContain(t('en', 'auth.step3.consentSentence'));
      expect(t('en', 'auth.step3.consentSentence')).toMatch(/18 years or older/);
      expect(html).toContain(t('en', 'auth.step3.futureTools'));
      expect(html).toMatch(/<input type="checkbox" name="futureTools"\s*\/?>/);
      expect(html).not.toMatch(/name="futureTools"[^>]*checked/);
      // Not a required field — the sentence next to it is the consent act,
      // there is no separate consent checkbox (PRD §10).
      expect(html).not.toMatch(/name="futureTools"[^>]*required/);
    });
  });
});
