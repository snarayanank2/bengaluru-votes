/**
 * Sign out (`POST /logout`) and the staff account page (`/account`), through
 * the real middleware: any staff role may use them, nobody else, and a
 * sign-out needs the CSRF token. Also that every staff bar carries the
 * Sign out form, and the order of the flag review page.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { Fixtures, client, db, run, schema, tokenForm, ward, type Auth, type Role } from './support/staff-harness';
import { onRequest } from '../../src/middleware';
import { SESSION_COOKIE, readSession } from '../../src/lib/session';
import { CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { submitPublicFlag } from '../../src/lib/flags';
import { anonReporter } from '../support/reporter';
import { t } from '../../src/i18n';
import * as LogoutRoute from '../../src/pages/logout';
import AccountRoute from '../../src/pages/account.astro';
import CuratorIndexRoute from '../../src/pages/curator/index.astro';
import AdminIndexRoute from '../../src/pages/admin/index.astro';
import TranscribeStartRoute from '../../src/pages/transcribe/index.astro';
import QueueItemRoute from '../../src/pages/curator/queue/[id].astro';

// This suite owns ward id 99413.
const WARD = ward(99413, 'Staff Account Test Ward');
const fx = new Fixtures('staff-account-test-');
const ROLES: Role[] = ['transcriber', 'curator', 'admin'];

/** Drives `/logout` (an endpoint, not a page) through the middleware. */
async function logout(auth?: Auth, opts: { method?: string; token?: string | null; fetchSite?: string } = {}): Promise<Response> {
  const url = new URL('/logout', 'https://bengaluruvotes.opencity.in');
  const headers = new Headers({ 'sec-fetch-site': opts.fetchSite ?? 'same-origin' });
  if (auth) headers.set('cookie', `${SESSION_COOKIE}=${auth.cookieValue}`);
  const method = opts.method ?? 'POST';
  let body: FormData | undefined;
  if (method === 'POST') {
    body = new FormData();
    const token = opts.token === undefined ? auth?.token : opts.token;
    if (token) body.set(CSRF_FIELD_NAME, token);
  }
  const request = new Request(url, { method, headers, body });
  const cookies = { get: (name: string) => (name === SESSION_COOKIE && auth ? { value: auth.cookieValue } : undefined) };
  const locals: Record<string, unknown> = {};
  const ctx = { request, url, site: new URL(url.origin), cookies, locals } as any;
  const handler = (LogoutRoute as any)[method] ?? (LogoutRoute as any).ALL;
  return (await onRequest(ctx, async () => handler({ cookies, request, locals }))) as Response;
}

const account = (auth?: Auth, form?: FormData) => run(AccountRoute, '/account', { auth, form });
const sessionAlive = async (auth: Auth) => (await readSession(auth.cookieValue)) !== null;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD);
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

describe('POST /logout', () => {
  it.each(ROLES)('ends a %s session, clears the cookie and goes to /login', async (role) => {
    const who = await fx.person(role);
    expect(await sessionAlive(who)).toBe(true);
    const res = await logout(who);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login?signedOut=1');
    expect(res.headers.get('set-cookie')).toMatch(/^bv_session=; .*Max-Age=0/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await sessionAlive(who)).toBe(false);
  });

  it('is refused without the CSRF token, and the session survives', async () => {
    const who = await fx.person('curator');
    expect((await logout(who, { token: null })).status).toBe(403);
    expect((await logout(who, { token: 'f'.repeat(64) })).status).toBe(403);
    expect(await sessionAlive(who)).toBe(true);
  });

  it('is refused from another site', async () => {
    const who = await fx.person('admin');
    expect((await logout(who, { fetchSite: 'cross-site' })).status).toBe(403);
    expect(await sessionAlive(who)).toBe(true);
  });

  it('is never done by a GET', async () => {
    const who = await fx.person('transcriber');
    const res = await logout(who, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(await sessionAlive(who)).toBe(true);
  });

  it('sends nobody signed out to /login', async () => {
    const res = await logout(undefined, { token: 'x' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/logout')}`);
  });
});

describe('/account', () => {
  it('sends an anonymous visitor to /login', async () => {
    const res = await account();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/account')}`);
  });

  it.each(ROLES)('shows a %s their email, role and a CSRF-protected Sign out', async (role) => {
    const who = await fx.person(role);
    const res = await account(who);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('content-security-policy')).toContain('nonce-');
    const html = await res.text();
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, who.userId));
    expect(html).toContain(row.email!);
    expect(html).toContain(t('en', `admin.users.results.role${role[0].toUpperCase()}${role.slice(1)}`));
    expect(html).toContain('action="/logout"');
    expect(html).toContain(`name="${CSRF_FIELD_NAME}" value="${who.token}"`);
    expect(html).not.toContain('<script>');
  });

  it('saves the language and shows the page in it', async () => {
    const who = await fx.person('curator');
    const res = await account(who, tokenForm(who, { formAction: 'language', language: 'kn' }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(t('kn', 'account.language.saved'));
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, who.userId));
    expect(row.language).toBe('kn');
  });

  it('refuses a language that is not offered', async () => {
    const who = await fx.person('curator');
    expect((await account(who, tokenForm(who, { formAction: 'language', language: 'fr' }))).status).toBe(400);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, who.userId));
    expect(row.language).toBe('en');
  });

  it('refuses a language change without the CSRF token', async () => {
    const who = await fx.person('transcriber');
    const form = new FormData();
    form.set('formAction', 'language');
    form.set('language', 'kn');
    expect((await account(who, form)).status).toBe(403);
  });
});

describe('every staff bar', () => {
  it.each([
    ['/curator', CuratorIndexRoute, 'curator'],
    ['/admin', AdminIndexRoute, 'admin'],
    ['/transcribe', TranscribeStartRoute, 'transcriber'],
  ] as const)('%s carries the account link and the Sign out form', async (path, route, role) => {
    const who = await fx.person(role);
    const html = await (await run(route, path, { auth: who })).text();
    expect(html).toContain('href="/account"');
    expect(html).toContain('action="/logout"');
    expect(html).toContain(`name="${CSRF_FIELD_NAME}" value="${who.token}"`);
    expect(html).toContain(t('en', 'staff.layout.signOut'));
  });
});

describe('the flag review page', () => {
  it('reads: context, published value, numbered reports, fix, reject, then spam last', async () => {
    const curator = await fx.person('curator');
    const c = await fx.candidateWithAffidavit(WARD.id);
    const ref = `candidate:${c.candidateId}:age`;
    let id = 0;
    for (const detail of ['first report', 'second report']) {
      id = (await submitPublicFlag(anonReporter(), { targetType: 'candidate_field', targetRef: ref, detail })).flagItemId!;
    }
    const res = await run(QueueItemRoute, `/curator/queue/${id}`, { auth: curator, params: { id: String(id) } });
    expect(res.status).toBe(200);
    const html = await res.text();

    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at(t('en', 'curator.queueItem.backToQueue')),
      at(t('en', 'curator.queueItem.published.heading')),
      at(t('en', 'flag.review.reportPosition', { n: 1, total: 2 })),
      at(t('en', 'flag.review.reportPosition', { n: 2, total: 2 })),
      at(t('en', 'curator.fix.heading')),
      at(t('en', 'curator.queueItem.reject.heading')),
      at(t('en', 'flag.review.spamSection.heading')),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // Per-report ticks, tied to the spam form; no database ids shown as labels.
    expect(html.match(/name="submissionId"[^>]*form="flag-spam-form"/g)).toHaveLength(2);
    expect(html.match(/data-spam-tick/g)).toHaveLength(2);
    expect(html).toContain(t('en', 'flag.review.markReportSpam'));
    expect(html).not.toContain('Select report');
    expect(html).toContain('data-spam-submit');
    expect(html).toContain('data-affidavit-toggle');
  });
});
