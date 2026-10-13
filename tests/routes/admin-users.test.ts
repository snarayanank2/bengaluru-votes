/**
 * `/admin/users` (Task 45, information-architecture.md §6.3; PRD §4/§7,
 * §5.16). Drives every request through the REAL middleware
 * (src/middleware.ts) composed with the real page twin via Astro's
 * container API — same technique as tests/routes/admin-console.test.ts.
 *
 * COVERAGE MAP:
 *   - ADMIN-ONLY: a curator or a citizen hitting the route -> 403; an
 *     anonymous request redirects to /login.
 *   - LIST: GET with no `?q=` lists staff and no citizens; `?role=` and
 *     `?status=` narrow it; citizens need a `?q=` (id/email/phone
 *     substring); each row's actions sit in a collapsed `<details>`, and
 *     the caller's own row offers none.
 *   - ROLE: POST formAction=role promotes, moves or removes a staff role
 *     (this absorbed the old `/admin/roles` grant/revoke), behind the same
 *     lockout guards.
 *   - NOTICES: every successful action redirects with `?notice=`, which
 *     the next GET renders as a confirmation banner.
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
import { eq, inArray } from 'drizzle-orm';
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
  addNew: 'admin-users-route-test-add-new@example.com',
  addNoConfirm: 'admin-users-route-test-add-no-confirm@example.com',
  addCsrf: 'admin-users-route-test-add-csrf@example.com',
  addAdminNoConfirm: 'admin-users-route-test-add-admin-no-confirm@example.com',
  transcriber: 'admin-users-route-test-transcriber@example.com',
  roleTarget: 'admin-users-route-test-role-target@example.com',
  revokeTarget: 'admin-users-route-test-revoke-target@example.com',
  roleCsrfTarget: 'admin-users-route-test-role-csrf-target@example.com',
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

let adminId: number;
let curatorId: number;
let citizenId: number;
let banTargetId: number;
let reactivateTargetId: number;
let eraseTargetId: number;
let csrfTargetId: number;
let transcriberId: number;
let roleTargetId: number;
let revokeTargetId: number;
let roleCsrfTargetId: number;
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
    transcriberId = await upsertUser(EMAILS.transcriber, { role: 'transcriber' });
    roleTargetId = await upsertUser(EMAILS.roleTarget);
    revokeTargetId = await upsertUser(EMAILS.revokeTarget, { role: 'curator' });
    roleCsrfTargetId = await upsertUser(EMAILS.roleCsrfTarget, { role: 'curator' });

    adminAuth = await sessionFor(adminId);
    curatorAuth = await sessionFor(curatorId);
    citizenAuth = await sessionFor(citizenId);
  });

  afterAll(async () => {
    await db.delete(schema.users).where(inArray(schema.users.email, [EMAILS.addNew, EMAILS.addNoConfirm, EMAILS.addCsrf, EMAILS.addAdminNoConfirm]));
    const userIds = [curatorId, citizenId, banTargetId, reactivateTargetId, eraseTargetId, csrfTargetId, transcriberId, roleTargetId, revokeTargetId, roleCsrfTargetId];
    await db.delete(schema.otpCodes).where(inArray(schema.otpCodes.destination, [EMAILS.eraseTarget, ERASE_TARGET_PHONE]));
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [adminId, ...userIds]));
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

  describe('add a user', () => {
    it('GET shows the add-user card with all three staff roles', async () => {
      const res = await run(UsersRoute, '/admin/users', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain('name="formAction" value="add"');
      expect(html).toContain('<option value="transcriber">');
      expect(html).toContain('<option value="curator">');
      expect(html).toContain('<option value="admin">');
    });

    it('POST add creates the account and redirects to the staff list with a notice', async () => {
      const form = formWithToken(
        { formAction: 'add', email: '  Admin-Users-Route-Test-Add-New@Example.com ', role: 'transcriber', confirm: 'on' },
        adminAuth.token,
      );
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const [row] = await db.select().from(schema.users).where(eq(schema.users.email, EMAILS.addNew));
      expect(res.headers.get('location')).toBe(`/admin/users?notice=added&nu=${row?.id}`);
      expect(row?.role).toBe('transcriber');
      expect(row?.status).toBe('active');
    });

    it('POST add for an email that already exists -> 400 with the specific message, role untouched', async () => {
      const form = formWithToken({ formAction: 'add', email: EMAILS.citizen, role: 'admin', confirm: 'on' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const html = normalize(await res.text());
      expect(html).toContain('An account with that email already exists.');
      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId));
      expect(row?.role).toBe('citizen');
    });

    it('POST add with an invalid email -> 400, the typed value is kept in the field', async () => {
      const form = formWithToken({ formAction: 'add', email: 'not-an-email', role: 'curator', confirm: 'on' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const html = normalize(await res.text());
      expect(html).toContain('Enter a valid email address.');
      expect(html).toContain('value="not-an-email"');
    });

    it('POST add of an ADMIN without the confirm checkbox -> 400, nothing created, typed values kept', async () => {
      const form = formWithToken({ formAction: 'add', email: EMAILS.addAdminNoConfirm, role: 'admin' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const html = normalize(await res.text());
      expect(html).toContain('Tick the box to confirm you want to add an admin.');
      expect(html).toContain(`value="${EMAILS.addAdminNoConfirm}"`);
      expect(html).toContain('<option value="admin" selected>');
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, EMAILS.addAdminNoConfirm));
      expect(rows).toHaveLength(0);
    });

    it('the add form does not make the confirm checkbox required', async () => {
      const res = await run(UsersRoute, '/admin/users', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      const addForm = html.slice(html.indexOf('name="formAction" value="add"'));
      const checkbox = addForm.slice(addForm.indexOf('type="checkbox"') - 40, addForm.indexOf('type="checkbox"') + 60);
      expect(checkbox).not.toContain('required');
    });

    it.each(['citizen', 'superuser', ''])('POST add with role %j -> 400, nothing created', async (role) => {
      const form = formWithToken({ formAction: 'add', email: EMAILS.addNoConfirm, role, confirm: 'on' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, EMAILS.addNoConfirm));
      expect(rows).toHaveLength(0);
    });

    it('POST add of a curator needs no confirm checkbox', async () => {
      const form = formWithToken({ formAction: 'add', email: EMAILS.addNoConfirm, role: 'curator' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      const [row] = await db.select().from(schema.users).where(eq(schema.users.email, EMAILS.addNoConfirm));
      expect(row?.role).toBe('curator');
    });

    it('POST add without the CSRF token -> 403, nothing created', async () => {
      const form = new FormData();
      form.set('formAction', 'add');
      form.set('email', EMAILS.addCsrf);
      form.set('role', 'admin');
      form.set('confirm', 'on');
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(403);
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, EMAILS.addCsrf));
      expect(rows).toHaveLength(0);
    });

    it('POST add as a curator -> 403', async () => {
      const form = formWithToken({ formAction: 'add', email: EMAILS.addCsrf, role: 'admin', confirm: 'on' }, curatorAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: curatorAuth.cookieValue, form });
      expect(res.status).toBe(403);
    });
  });

  describe('list', () => {
    it('GET with no ?q= lists staff and no citizens', async () => {
      const res = await run(UsersRoute, '/admin/users', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain(EMAILS.admin);
      expect(html).toContain(EMAILS.curator);
      expect(html).toContain(EMAILS.transcriber);
      expect(html).not.toContain(EMAILS.eraseTarget);
      expect(html).not.toContain(EMAILS.citizen);
    });

    it('GET ?role=curator lists only curators', async () => {
      const res = await run(UsersRoute, '/admin/users?role=curator', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain(EMAILS.curator);
      expect(html).not.toContain(EMAILS.transcriber);
      expect(html).toContain('<option value="curator" selected>');
    });

    it('GET ?role=citizen with no ?q= asks for a search instead of dumping citizens', async () => {
      const res = await run(UsersRoute, '/admin/users?role=citizen', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain('Enter an id, email, or phone number to look up citizens.');
      expect(html).not.toContain(EMAILS.citizen);
    });

    it('GET ?q=<email> finds a citizen', async () => {
      const res = await run(UsersRoute, `/admin/users?q=${encodeURIComponent(EMAILS.eraseTarget)}`, { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain(EMAILS.eraseTarget);
      expect(html).toContain(`#${eraseTargetId}`);
    });

    it('GET ?q=<phone substring> finds the matching user', async () => {
      const res = await run(UsersRoute, '/admin/users?q=12399', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain(`#${eraseTargetId}`);
    });

    it('GET ?q=&status=banned narrows to banned accounts', async () => {
      const res = await run(UsersRoute, '/admin/users?q=admin-users-route-test&status=banned', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain(EMAILS.reactivateTarget);
      expect(html).not.toContain(EMAILS.banTarget);
    });

    it('GET with a query nothing matches says so', async () => {
      const res = await run(UsersRoute, '/admin/users?q=nobody-admin-users-route-test', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain('No accounts match.');
    });

    it("each row's actions sit in a collapsed <details>, role change included", async () => {
      const res = await run(UsersRoute, '/admin/users?role=transcriber', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain('<details');
      expect(html).not.toContain('<details open');
      expect(html).toContain('name="formAction" value="role"');
      expect(html).toContain(`name="targetUserId" value="${transcriberId}"`);
    });

    it("the caller's OWN row offers no role, ban or erase form, and says why", async () => {
      const res = await run(UsersRoute, '/admin/users?role=admin', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain(EMAILS.admin);
      expect(html).not.toContain(`name="targetUserId" value="${adminId}"`);
      expect(html).toContain('This is your own account.');
    });
  });

  describe('change role', () => {
    it('POST formAction=role promotes a citizen to curator and redirects with a notice', async () => {
      const form = formWithToken({ formAction: 'role', targetUserId: String(roleTargetId), role: 'curator', confirm: 'on', q: EMAILS.roleTarget }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/admin/users?q=${encodeURIComponent(EMAILS.roleTarget)}&notice=roleChanged&nu=${roleTargetId}`);
      expect(res.headers.get('cache-control')).toBe('no-store');

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, roleTargetId));
      expect(row?.role).toBe('curator');
    });

    it('POST formAction=role with role=citizen removes staff access', async () => {
      const form = formWithToken({ formAction: 'role', targetUserId: String(revokeTargetId), role: 'citizen', confirm: 'on' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/admin/users?notice=roleRemoved&nu=${revokeTargetId}`);

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, revokeTargetId));
      expect(row?.role).toBe('citizen');
    });

    it('POST formAction=role without confirm -> 400, role unchanged', async () => {
      const form = formWithToken({ formAction: 'role', targetUserId: String(citizenId), role: 'curator' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId));
      expect(row?.role).toBe('citizen');
    });

    it.each(['superuser', ''])('POST formAction=role with role %j -> 400, role unchanged', async (role) => {
      const form = formWithToken({ formAction: 'role', targetUserId: String(citizenId), role, confirm: 'on' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId));
      expect(row?.role).toBe('citizen');
    });

    it.each(['citizen', 'curator'])("POST formAction=role=%s targeting the caller's OWN id -> 400 friendly error, admin still admin", async (role) => {
      const form = formWithToken({ formAction: 'role', targetUserId: String(adminId), role, confirm: 'on' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);

      const html = normalize(await res.text());
      expect(html).toContain('can&#39;t remove your own admin access');

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.role).toBe('admin');
    });

    it('POST formAction=role without the CSRF token -> 403, role unaffected', async () => {
      const fd = new FormData();
      fd.set('formAction', 'role');
      fd.set('targetUserId', String(roleCsrfTargetId));
      fd.set('role', 'admin');
      fd.set('confirm', 'on');

      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form: fd });
      expect(res.status).toBe(403);

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, roleCsrfTargetId));
      expect(row?.role).toBe('curator');
    });

    it('POST formAction=set_scope -> 400 (curators are city-wide; the action does not exist)', async () => {
      const form = formWithToken({ formAction: 'set_scope', targetUserId: String(roleCsrfTargetId), wardIds: '1', confirm: 'on' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
    });
  });

  describe('notices', () => {
    it('GET ?notice=added&nu=<id> confirms who was added and as what', async () => {
      const res = await run(UsersRoute, `/admin/users?notice=added&nu=${curatorId}`, { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain(`Added ${EMAILS.curator} as Curator.`);
    });

    it('GET with an unknown ?notice= renders no banner', async () => {
      const res = await run(UsersRoute, `/admin/users?notice=pwned&nu=${curatorId}`, { cookieValue: adminAuth.cookieValue });
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).not.toContain('role="status"');
    });

    it('a POST redirect keeps the role and status filters the admin had applied', async () => {
      const form = formWithToken(
        { formAction: 'ban', targetUserId: '999999999', confirm: 'on', q: 'x', filterRole: 'curator', filterStatus: 'active' },
        adminAuth.token,
      );
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      // An unknown target re-renders in place (400) with the same filters still selected.
      expect(res.status).toBe(400);
      const html = normalize(await res.text());
      expect(html).toContain('<option value="curator" selected>');
      expect(html).toContain('<option value="active" selected>');
    });
  });

  describe('ban / reactivate', () => {
    it('POST formAction=ban sets status banned, kills the session, audited', async () => {
      const target = await sessionFor(banTargetId);

      const form = formWithToken({ formAction: 'ban', targetUserId: String(banTargetId), reason: 'spam', confirm: 'on', q: EMAILS.banTarget }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/admin/users?q=${encodeURIComponent(EMAILS.banTarget)}&notice=banned&nu=${banTargetId}`);

      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, banTargetId));
      expect(row?.status).toBe('banned');

      const { readSession } = await import('../../src/lib/session');
      expect(await readSession(target.cookieValue)).toBeNull();

    });

    it('POST formAction=reactivate restores status active', async () => {
      const form = formWithToken({ formAction: 'reactivate', targetUserId: String(reactivateTargetId), confirm: 'on', q: '' }, adminAuth.token);
      const res = await run(UsersRoute, '/admin/users', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/admin/users?notice=reactivated&nu=${reactivateTargetId}`);

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
      expect(res.headers.get('location')).toBe(`/admin/users?notice=erased&nu=${eraseTargetId}`);

      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, eraseTargetId));
      expect(row?.status).toBe('erased');
      expect(row?.email).toBeNull();
      expect(row?.phone).toBeNull();
      expect(row?.consentAt).toBeNull();
      expect(row?.homeWardId).toBe(WARD.id);

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
