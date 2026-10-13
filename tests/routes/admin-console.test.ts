/**
 * `/admin` and the retired `/admin/roles` (Task 44, information-architecture.md
 * §6.1; PRD §7/§10/§11). Drives every request through the REAL middleware
 * (src/middleware.ts) composed with the real page twins via Astro's
 * container API — same technique as tests/routes/curator-ward.test.ts.
 *
 * COVERAGE MAP:
 *   - ADMIN-ONLY: a curator or a citizen hitting /admin -> 403
 *     (src/middleware.ts's /admin/* route class).
 *   - CONSOLE: /admin renders its nav links (Manage users, Partners &
 *     coverage) and no longer links the retired Roles page.
 *   - RETIRED ROLES PAGE: /admin/roles permanently redirects to
 *     /admin/users, which absorbed grant/revoke
 *     (tests/routes/admin-users.test.ts owns those).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken } from '../../src/lib/csrf';
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
let adminAuth: { cookieValue: string; token: string };
let curatorAuth: { cookieValue: string; token: string };
let citizenAuth: { cookieValue: string; token: string };

describe('/admin, retired /admin/roles (Task 44)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    adminId = await upsertUser(EMAILS.admin, 'admin');
    curatorId = await upsertUser(EMAILS.curator, 'curator');
    citizenId = await upsertUser(EMAILS.citizen, 'citizen');

    adminAuth = await sessionFor(adminId);
    curatorAuth = await sessionFor(curatorId);
    citizenAuth = await sessionFor(citizenId);
  });

  afterAll(async () => {
    const userIds = [curatorId, citizenId];
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [adminId, ...userIds]));
    await db.delete(schema.users).where(inArray(schema.users.id, [adminId, ...userIds]));
    await client.end();
  });

  describe('admin-only', () => {
    it('GET /admin as a curator -> 403', async () => {
      const res = await run(ConsoleRoute, '/admin', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(403);
    });

    it('GET /admin as a citizen -> 403', async () => {
      const res = await run(ConsoleRoute, '/admin', { cookieValue: citizenAuth.cookieValue });
      expect(res.status).toBe(403);
    });
  });

  describe('console', () => {
    it('renders the nav links as admin, without the retired Roles page', async () => {
      const res = await run(ConsoleRoute, '/admin', { cookieValue: adminAuth.cookieValue });
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain('href="/admin/users"');
      expect(html).toContain('Manage users');
      expect(html).toContain('Partners');
      expect(html).not.toContain('href="/admin/roles"');
    });
  });

  describe('retired roles page', () => {
    it('GET /admin/roles as admin -> 301 to /admin/users', async () => {
      const res = await run(RolesRoute, '/admin/roles', { cookieValue: adminAuth.cookieValue });
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe('/admin/users');
    });

    it('GET /admin/roles as a curator -> 403', async () => {
      const res = await run(RolesRoute, '/admin/roles', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(403);
    });
  });
});
