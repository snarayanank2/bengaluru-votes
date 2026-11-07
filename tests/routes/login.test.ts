/**
 * `/login`, `/kn/login` — staff sign-in with a per-account credential.
 * Exercises the real page twins (src/pages/login.astro,
 * src/pages/kn/login.astro) against a real Postgres DB.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';
import { SESSION_COOKIE } from '../../src/lib/session';
import { hashPassword } from '../../src/lib/password';
import LoginEn from '../../src/pages/login.astro';
import LoginKn from '../../src/pages/kn/login.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const PASSWORD = 'route-test-own-credential-0001';
let HASH: string;

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

const KNOWN_EMAIL = 'login-route-known@example.com';
const NEW_EMAIL = 'login-route-new@example.com';
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
}

describe('/login, /kn/login', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    HASH = await hashPassword(PASSWORD);
  });

  afterAll(async () => {
    await resetFixtures();
    await client.end();
  });

  beforeEach(async () => {
    await resetFixtures();
  });

  it.each(['en', 'kn'] as const)('%s: GET renders the email + password form, status 200, noindex', async (lang) => {
    const res = await get(lang);
    expect(res.status).toBe(200);
    const html = normalize(await res.text());
    expect(html).toContain('name="destination"');
    expect(html).toContain('name="password"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).not.toContain('name="step"');
    expect(html).toContain(t(lang, 'auth.password.heading'));
    expect(html).toContain('name="robots" content="noindex"');
  });

  it('right password for a staff user -> 302 to next with a session cookie, no-store', async () => {
    await db.insert(schema.users).values({ email: KNOWN_EMAIL, role: 'curator', status: 'active', passwordHash: HASH });
    const res = await post('en', { destination: KNOWN_EMAIL, password: PASSWORD, next: '/admin/users' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/users');
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('a transcriber with nowhere particular to go lands on /transcribe', async () => {
    await db.insert(schema.users).values({ email: KNOWN_EMAIL, role: 'transcriber', status: 'active', passwordHash: HASH });
    const res = await post('en', { destination: KNOWN_EMAIL, password: PASSWORD, next: '/' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/transcribe');
  });

  it.each([['curator', '/curator'], ['admin', '/admin']] as const)('a %s with nowhere particular to go lands on %s', async (role, landing) => {
    await db.insert(schema.users).values({ email: KNOWN_EMAIL, role, status: 'active', passwordHash: HASH });
    const res = await post('en', { destination: KNOWN_EMAIL, password: PASSWORD, next: '/' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(landing);
  });

  it('a transcriber who asked for a page still gets that page', async () => {
    await db.insert(schema.users).values({ email: KNOWN_EMAIL, role: 'transcriber', status: 'active', passwordHash: HASH });
    const res = await post('en', { destination: KNOWN_EMAIL, password: PASSWORD, next: '/transcribe/guide' });
    expect(res.headers.get('location')).toBe('/transcribe/guide');
  });

  it('wrong password -> re-renders with the error, keeps the email, sets no cookie', async () => {
    await db.insert(schema.users).values({ email: KNOWN_EMAIL, role: 'curator', status: 'active', passwordHash: HASH });
    const res = await post('en', { destination: KNOWN_EMAIL, password: 'wrong-password-wrong-password', next: '/' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    const html = normalize(await res.text());
    expect(html).toContain(t('en', 'auth.password.error.invalid'));
    expect(html).toContain(`value="${KNOWN_EMAIL}"`);
    expect(html).not.toContain('wrong-password-wrong-password');
  });

  // Design-system §7.10: a failed submit puts focus on the relevant field (a
  // keyboard user must not restart at the top). `autofocus` does it without a script.
  it('a failed sign-in autofocuses the email field and links the error to both fields', async () => {
    await db.insert(schema.users).values({ email: KNOWN_EMAIL, role: 'curator', status: 'active', passwordHash: HASH });
    const html = normalize(await (await post('en', { destination: KNOWN_EMAIL, password: 'wrong-password-wrong-password', next: '/' })).text());
    const email = html.match(/<input[^>]*id="login-destination"[^>]*>/)![0];
    const secret = html.match(/<input[^>]*id="login-password"[^>]*>/)![0];
    expect(email).toContain('autofocus');
    expect(email).toContain('aria-describedby="login-error"');
    expect(email).toContain('aria-invalid="true"');
    expect(secret).toContain('aria-invalid="true"');
    expect(secret).not.toContain('autofocus');
    expect(secret).toContain('aria-describedby="login-error"');
    expect(html).toContain('id="login-error"');
    expect(html).toContain('role="alert"');
  });

  it('a first visit does not steal focus or point at an error that is not there', async () => {
    const html = normalize(await (await get('en')).text());
    expect(html).not.toContain('autofocus');
    expect(html).not.toContain('aria-describedby="login-error"');
    expect(html).not.toContain('aria-invalid');
  });

  it('an unknown email with the right password gets the SAME error and creates no user', async () => {
    const res = await post('en', { destination: NEW_EMAIL, password: PASSWORD, next: '/' });
    expect(res.status).toBe(200);
    expect(normalize(await res.text())).toContain(t('en', 'auth.password.error.invalid'));
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, NEW_EMAIL));
    expect(rows).toHaveLength(0);
  });

  it('a POST with no password field at all fails cleanly (no 500)', async () => {
    const res = await post('en', { destination: KNOWN_EMAIL, next: '/' });
    expect(res.status).toBe(200);
    expect(normalize(await res.text())).toContain(t('en', 'auth.password.error.invalid'));
  });

  it('an account with no password set cannot sign in', async () => {
    await db.insert(schema.users).values({ email: KNOWN_EMAIL, role: 'admin', status: 'active' });
    const res = await post('en', { destination: KNOWN_EMAIL, password: PASSWORD, next: '/' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it("another account's credential does not work", async () => {
    await db.insert(schema.users).values({ email: KNOWN_EMAIL, role: 'admin', status: 'active', passwordHash: await hashPassword('someone-elses-credential-99') });
    const res = await post('en', { destination: KNOWN_EMAIL, password: PASSWORD, next: '/' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  describe('next open-redirect hardening (isSameOriginRelative)', () => {
    it('GET ?next=https://evil.example renders the hidden next field as "/" — sanitized before it reaches the form', async () => {
      const res = await get('en', '?next=https://evil.example');
      const html = normalize(await res.text());
      expect(html).toContain('name="next" value="/"');
    });

    it.each(['https://evil.example/x', '//evil.example/x'])('a hostile next (%s) collapses to the staff default, never off-site', async (next) => {
      await db.insert(schema.users).values({ email: KNOWN_EMAIL, role: 'curator', status: 'active', passwordHash: HASH });
      const res = await post('en', { destination: KNOWN_EMAIL, password: PASSWORD, next });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/curator');
    });
  });
});
