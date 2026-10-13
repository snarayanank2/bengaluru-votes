/**
 * `/admin`, `/admin/roles` (Task 44, information-architecture.md §6.1/§6.2;
 * PRD §7/§10/§11). Drives every request through the REAL middleware
 * (src/middleware.ts) composed with the real page twins via Astro's
 * container API — same technique as tests/routes/curator-ward.test.ts.
 *
 * COVERAGE MAP:
 *   - ADMIN-ONLY: a curator or a citizen hitting either route -> 403
 *     (src/middleware.ts's /admin/* route class); an anonymous request
 *     redirects to /login.
 *   - CONSOLE: /admin renders its nav links (Roles & access, Manage users,
 *     Partners & coverage, Audit log — all real pages by Task 47).
 *   - GRANT: POST formAction=grant on /admin/roles actually promotes a
 *     citizen and writes a grant_role audit row.
 *   - REVOKE: POST formAction=revoke demotes to citizen.
 *   - NO WARD SCOPE: curators are city-wide, so the page offers no scope
 *     form and the old `set_scope` action is rejected.
 *   - CSRF: POST without the token -> 403, DB unaffected.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';

import ConsoleRoute from '../../src/pages/admin/index.astro';
import RolesRoute from '../../src/pages/admin/roles.astro';

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

const EMAILS = {
  admin: 'admin-roles-route-test-admin@example.com',
  curator: 'admin-roles-route-test-curator@example.com',
  citizen: 'admin-roles-route-test-citizen@example.com',
  grantTarget: 'admin-roles-route-test-grant-target@example.com',
  revokeTarget: 'admin-roles-route-test-revoke-target@example.com',
  csrfTarget: 'admin-roles-route-test-csrf-target@example.com',
};

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

async function upsertUser(email: string, role: 'citizen' | 'curator' | 'admin'): Promise<number> {
  const [row] = await db
    .insert(schema.users)
    .values({ email, role, status: 'active' })
    .onConflictDoUpdate({ target: schema.users.email, set: { role, status: 'active' } })
    .returning({ id: schema.users.id });
  return row!.id;
}

let adminId: number;
let curatorId: number;
let citizenId: number;
let grantTargetId: number;
let revokeTargetId: number;
let csrfTargetId: number;
let adminAuth: { cookieValue: string; token: string };
let curatorAuth: { cookieValue: string; token: string };
let citizenAuth: { cookieValue: string; token: string };

describe('/admin, /admin/roles (Task 44)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    adminId = await upsertUser(EMAILS.admin, 'admin');
    curatorId = await upsertUser(EMAILS.curator, 'curator');
    citizenId = await upsertUser(EMAILS.citizen, 'citizen');
    grantTargetId = await upsertUser(EMAILS.grantTarget, 'citizen');
    revokeTargetId = await upsertUser(EMAILS.revokeTarget, 'curator');
    csrfTargetId = await upsertUser(EMAILS.csrfTarget, 'curator');

    adminAuth = await sessionFor(adminId);
    curatorAuth = await sessionFor(curatorId);
    citizenAuth = await sessionFor(citizenId);
  });

  afterAll(async () => {
    const userIds = [curatorId, citizenId, grantTargetId, revokeTargetId, csrfTargetId];
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [adminId, ...userIds]));
    await db.delete(schema.users).where(inArray(schema.users.id, [adminId, ...userIds]));
    await client.end();
  });

  describe('admin-only', () => {
    it('GET /admin as a curator -> 403', async () => {
      const res = await run(ConsoleRoute, '/admin', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(403);
    });

    it('GET /admin/roles as a curator -> 403', async () => {
      const res = await run(RolesRoute, '/admin/roles', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(403);
    });

    it('GET /admin/roles as a citizen -> 403', async () => {
      const res = await run(RolesRoute, '/admin/roles', { cookieValue: citizenAuth.cookieValue });
      expect(res.status).toBe(403);
    });

    it('GET /admin/roles anonymous -> redirect to /login', async () => {
      const res = await run(RolesRoute, '/admin/roles');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/login');
    });

    it('GET /admin/roles as admin -> 200, no-store', async () => {
      const res = await run(RolesRoute, '/admin/roles', { cookieValue: adminAuth.cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  });

  describe('console', () => {
    it('renders the nav links as admin', async () => {
      const res = await run(ConsoleRoute, '/admin', { cookieValue: adminAuth.cookieValue });
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain('href="/admin/roles"');
      expect(html).toContain('Manage users');
      expect(html).toContain('Partners');
    });
  });

  describe('grant', () => {
    it('POST formAction=grant promotes a citizen to curator and audits it', async () => {
      const form = formWithToken({ formAction: 'grant', lookup: EMAILS.grantTarget, role: 'curator', confirm: 'on' }, adminAuth.token);
      const res = await run(RolesRoute, '/admin/roles', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/admin/roles');

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, grantTargetId));
      expect(row?.role).toBe('curator');

    });

    it('POST formAction=grant without confirm -> 400, role unchanged', async () => {
      const form = formWithToken({ formAction: 'grant', lookup: EMAILS.citizen, role: 'curator' }, adminAuth.token);
      const res = await run(RolesRoute, '/admin/roles', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId));
      expect(row?.role).toBe('citizen');
    });
  });

  describe('revoke', () => {
    it('POST formAction=revoke demotes to citizen', async () => {
      const form = formWithToken({ formAction: 'revoke', targetUserId: String(revokeTargetId), confirm: 'on' }, adminAuth.token);
      const res = await run(RolesRoute, '/admin/roles', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, revokeTargetId));
      expect(row?.role).toBe('citizen');
    });

    it('POST formAction=revoke targeting the caller\'s OWN id -> 400 friendly error, admin still admin (Task 44 review lockout guard)', async () => {
      const form = formWithToken({ formAction: 'revoke', targetUserId: String(adminId), confirm: 'on' }, adminAuth.token);
      const res = await run(RolesRoute, '/admin/roles', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);

      const html = normalize(await res.text());
      expect(html).toContain("can&#39;t remove your own admin access");

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.role).toBe('admin');
    });
  });

  describe('no ward scope (curators are city-wide)', () => {
    it('the roles page offers no scope form', async () => {
      const res = await run(RolesRoute, '/admin/roles', { cookieValue: adminAuth.cookieValue });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain('value="set_scope"');
      expect(html).not.toContain('name="wardIds"');
      expect(html).not.toContain('name="zone"');
    });

    it('POST formAction=set_scope -> 400 (the action no longer exists)', async () => {
      const form = formWithToken(
        { formAction: 'set_scope', targetUserId: String(csrfTargetId), wardIds: '1', zone: '', confirm: 'on' },
        adminAuth.token,
      );
      const res = await run(RolesRoute, '/admin/roles', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
    });
  });

  describe('CSRF', () => {
    it('POST without the CSRF token -> 403, role unaffected', async () => {
      const fd = new FormData();
      fd.set('formAction', 'grant');
      fd.set('lookup', EMAILS.csrfTarget);
      fd.set('role', 'admin');
      fd.set('confirm', 'on');

      const res = await run(RolesRoute, '/admin/roles', { method: 'POST', cookieValue: adminAuth.cookieValue, form: fd });
      expect(res.status).toBe(403);

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, csrfTargetId));
      expect(row?.role).toBe('curator');
    });

    it('POST with a valid CSRF token succeeds', async () => {
      const form = formWithToken({ formAction: 'grant', lookup: EMAILS.csrfTarget, role: 'admin', confirm: 'on' }, adminAuth.token);
      const res = await run(RolesRoute, '/admin/roles', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, csrfTargetId));
      expect(row?.role).toBe('admin');
    });
  });
});
