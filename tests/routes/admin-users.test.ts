/**
 * `/admin/users` (Task 45, information-architecture.md §6.3; PRD §4/§7,
 * §5.16). Drives every request through the REAL middleware
 * (src/middleware.ts) composed with the real page twin via Astro's
 * container API — same technique as tests/routes/admin-roles.test.ts.
 *
 * COVERAGE MAP:
 *   - ADMIN-ONLY: a curator or a citizen hitting the route -> 403; an
 *     anonymous request redirects to /login.
 *   - SEARCH: GET with no `?q=` shows the "enter something" prompt; GET
 *     `?q=` finds the matching user by id/email/phone substring.
 *   - BAN: POST formAction=ban sets status banned, kills the session, and
 *     audits it, redirecting back to the same `?q=`.
 *   - REACTIVATE: POST formAction=reactivate restores status active.
 *   - ERASE: POST formAction=erase severs identity (nulls contact/consent,
 *     status erased) — the load-bearing DPDP behaviour, re-verified here
 *     at the HTTP layer (tests/unit/erasure.test.ts owns the exhaustive
 *     lib-level version).
 *   - GUARDS: self-ban/self-erase and confirm-required surface as a
 *     friendly 400, not a 500.
 *   - CSRF: POST without the token -> 403, DB unaffected.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';

import UsersRoute from '../../src/pages/admin/users.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const SITE_URL = new URL(SITE_ORIGIN);

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ids (Task 45 brief: "use high dedicated ids").
// tests/unit/erasure.test.ts owns 99800-99819; this route suite owns
// 99820-99839.
const WARD = {
  id: 99820,
  nameEn: 'Admin Users Route Test Ward',
  nameKn: 'ಆಬ',
  corporation: 'south' as const,
  zone: 'Admin Users Route Test Zone',
  boundaryRef: 'admin-users-route-test-ward',
};

const EMAILS = {
  admin: 'admin-users-route-test-admin@example.com',
  curator: 'admin-users-route-test-curator@example.com',
  citizen: 'admin-users-route-test-citizen@example.com',
  banTarget: 'admin-users-route-test-ban-target@example.com',
  reactivateTarget: 'admin-users-route-test-reactivate-target@example.com',
  eraseTarget: 'admin-users-route-test-erase-target@example.com',
  csrfTarget: 'admin-users-route-test-csrf-target@example.com',
};
const ERASE_TARGET_PHONE = '+919900012399';

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

interface RunOptions {
  method?: 'GET' | 'POST';
  cookieValue?: string;
  form?: FormData;
  secFetchSite?: string | null;
}

async function run(component: unknown, path: string, opts: RunOptions = {}): Promise<Response> {
  const { method = 'GET', cookieValue, form, secFetchSite = 'same-origin' } = opts;
  const url = new URL(path, SITE_URL);

  const headers = new Headers();
  if (cookieValue) headers.set('cookie', `${SESSION_COOKIE}=${cookieValue}`);
  if (secFetchSite) headers.set('sec-fetch-site', secFetchSite);

  const request = new Request(url, { method, headers, body: form });

  const cookiesStub = {
    get: (name: string) => (name === SESSION_COOKIE && cookieValue ? { value: cookieValue } : undefined),
  };
  const locals: Record<string, unknown> = {};
  const ctx = { request, url, site: SITE_URL, cookies: cookiesStub, locals } as any;

  const container = await makeContainer();
  const next = async () =>
    container.renderToResponse(component as any, {
      partial: false,
      request,
      locals: locals as unknown as App.Locals,
    });

  return (await onRequest(ctx, next)) as Response;
}

function formWithToken(fields: Record<string, string>, token: string): FormData {
  const fd = new FormData();
  fd.set(CSRF_FIELD_NAME, token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function sessionFor(userId: number): Promise<{ cookieValue: string; token: string }> {
  const { id, cookieValue } = await createSession(userId);
  return { cookieValue, token: issueCsrfToken(id) };
}

type UserInsert = typeof schema.users.$inferInsert;

async function upsertUser(email: string, fields: Partial<UserInsert> = {}): Promise<number> {
  const values: UserInsert = { email, role: 'citizen', status: 'active', ...fields };
  const [row] = await db
    .insert(schema.users)
    .values(values)
    .onConflictDoUpdate({ target: schema.users.email, set: values })
    .returning({ id: schema.users.id });
  return row!.id;
}

function auditEntityIdIn(userIds: number[]) {
  return inArray(schema.auditLog.entityId, userIds.map(String));
}

let adminId: number;
let curatorId: number;
let citizenId: number;
let banTargetId: number;
let reactivateTargetId: number;
let eraseTargetId: number;
let csrfTargetId: number;
let adminAuth: { cookieValue: string; token: string };
let curatorAuth: { cookieValue: string; token: string };
let citizenAuth: { cookieValue: string; token: string };

describe('/admin/users (Task 45)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });

    adminId = await upsertUser(EMAILS.admin, { role: 'admin' });
    curatorId = await upsertUser(EMAILS.curator, { role: 'curator' });
    citizenId = await upsertUser(EMAILS.citizen);
    banTargetId = await upsertUser(EMAILS.banTarget);
    reactivateTargetId = await upsertUser(EMAILS.reactivateTarget, { status: 'banned' });
    eraseTargetId = await upsertUser(EMAILS.eraseTarget, { phone: ERASE_TARGET_PHONE, homeWardId: WARD.id, consentAt: new Date(), consentVersion: 'v1' });
    csrfTargetId = await upsertUser(EMAILS.csrfTarget);

    adminAuth = await sessionFor(adminId);
    curatorAuth = await sessionFor(curatorId);
    citizenAuth = await sessionFor(citizenId);
  });

  afterAll(async () => {
    const userIds = [curatorId, citizenId, banTargetId, reactivateTargetId, eraseTargetId, csrfTargetId];
    await db.delete(schema.otpCodes).where(inArray(schema.otpCodes.destination, [EMAILS.eraseTarget, ERASE_TARGET_PHONE]));
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [adminId, ...userIds]));
    await db.delete(schema.auditLog).where(auditEntityIdIn(userIds)); // no-op: audit_log is append-only
    await db.delete(schema.users).where(inArray(schema.users.id, [adminId, ...userIds]));
    await db.delete(schema.wards).where(eq(schema.wards.id, WARD.id));
    await client.end();
  });

  describe('admin-only', () => {
    it('GET /admin/users as a curator -> 403', async () => {
      const res = await run(UsersRoute, '/admin/users', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(403);
    });

    it('GET /admin/users as a citizen -> 403', async () => {
      const res = await run(UsersRoute, '/admin/users', { cookieValue: citizenAuth.cookieValue });
      expect(res.status).toBe(403);
    });

    it('GET /admin/users anonymous -> redirect to /login', async () => {
      const res = await run(UsersRoute, '/admin/users');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/login');
    });

    it('GET /admin/users as admin -> 200, no-store', async () => {
      const res = await run(UsersRoute, '/admin/users', { cookieValue: adminAuth.cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  });

  describe('search', () => {
    it('GET with no ?q= shows the search prompt, not a full user dump', async () => {
      const res = await run(UsersRoute, '/admin/users', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain('Enter an id, email, or phone number above to find an account.');
      expect(html).not.toContain(EMAILS.eraseTarget);
    });

    it('GET ?q=<email> finds the matching user', async () => {
      const res = await run(UsersRoute, `/admin/users?q=${encodeURIComponent(EMAILS.eraseTarget)}`, { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain(EMAILS.eraseTarget);
      expect(html).toContain(String(eraseTargetId));
    });

    it('GET ?q=<phone substring> finds the matching user', async () => {
      const res = await run(UsersRoute, '/admin/users?q=12399', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain(String(eraseTargetId));
    });
  });

  describe('ban / reactivate', () => {
    it('POST formAction=ban sets status banned, kills the session, audited', async () => {
      const target = await sessionFor(banTargetId);

      const form = formWithToken({ formAction: 'ban', targetUserId: String(banTargetId), reason: 'spam', confirm: 'on', q: EMAILS.banTarget }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/admin/users?q=${encodeURIComponent(EMAILS.banTarget)}`);

      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, banTargetId));
      expect(row?.status).toBe('banned');

      const { readSession } = await import('../../src/lib/session');
      expect(await readSession(target.cookieValue)).toBeNull();

      const [audit] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, 'ban_user'), eq(schema.auditLog.entityId, String(banTargetId))));
      expect(audit).toBeDefined();
      expect(audit!.actorUserId).toBe(adminId);
    });

    it('POST formAction=reactivate restores status active', async () => {
      const form = formWithToken({ formAction: 'reactivate', targetUserId: String(reactivateTargetId), confirm: 'on', q: '' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);

      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, reactivateTargetId));
      expect(row?.status).toBe('active');
    });

    it('POST formAction=ban without confirm -> 400, status unchanged', async () => {
      const form = formWithToken({ formAction: 'ban', targetUserId: String(banTargetId), q: '' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
    });

    it("POST formAction=ban targeting the caller's OWN id -> 400 friendly error, admin still active", async () => {
      const form = formWithToken({ formAction: 'ban', targetUserId: String(adminId), confirm: 'on', q: '' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const html = normalize(await res.text());
      expect(html).toContain("You can&#39;t ban your own account.");

      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.status).toBe('active');
    });
  });

  describe('erase', () => {
    it('POST formAction=erase severs identity: contact/consent nulled, status erased', async () => {
      const form = formWithToken({ formAction: 'erase', targetUserId: String(eraseTargetId), confirm: 'on', q: '' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);

      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, eraseTargetId));
      expect(row?.status).toBe('erased');
      expect(row?.email).toBeNull();
      expect(row?.phone).toBeNull();
      expect(row?.consentAt).toBeNull();
      expect(row?.homeWardId).toBe(WARD.id);

      const [audit] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, 'erase_user'), eq(schema.auditLog.entityId, String(eraseTargetId))));
      expect(audit).toBeDefined();
      expect(JSON.stringify([audit!.oldValue, audit!.newValue])).not.toContain(EMAILS.eraseTarget);
    });

    it("POST formAction=erase targeting the caller's OWN id -> 400 friendly error", async () => {
      const form = formWithToken({ formAction: 'erase', targetUserId: String(adminId), confirm: 'on', q: '' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const html = normalize(await res.text());
      expect(html).toContain("You can&#39;t erase your own account.");
    });
  });

  describe('CSRF', () => {
    it('POST without the CSRF token -> 403, status unaffected', async () => {
      const fd = new FormData();
      fd.set('formAction', 'ban');
      fd.set('targetUserId', String(csrfTargetId));
      fd.set('confirm', 'on');
      fd.set('q', '');

      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form: fd });
      expect(res.status).toBe(403);

      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, csrfTargetId));
      expect(row?.status).toBe('active');
    });

    it('POST with a valid CSRF token succeeds', async () => {
      const form = formWithToken({ formAction: 'ban', targetUserId: String(csrfTargetId), confirm: 'on', q: '' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);

      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, csrfTargetId));
      expect(row?.status).toBe('banned');
    });
  });
});
