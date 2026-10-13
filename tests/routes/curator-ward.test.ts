/**
 * `/curator/ward/{id}`, `/curator/ward/{id}/issues` (Task 39, PRD §9.1,
 * §5.4/§5.5; design-system.md §7.13). Drives every request through the
 * REAL middleware (src/middleware.ts) composed with the real page twins
 * via Astro's container API — same technique as
 * tests/routes/curator-candidate.test.ts.
 *
 * COVERAGE MAP:
 *   - NO READINESS OR SIGN-OFF (dropped 2026-08-15): the ward page shows
 *     metadata and links only; a sign_off POST is rejected (400), and a
 *     POST with no CSRF token gets 403.
 *   - WARD ISSUES: add/rename/remove all work end-to-end.
 *   The curator here has no ward assignment of any kind — curators are
 *   city-wide.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';

import WardEditRoute from '../../src/pages/curator/ward/[id].astro';
import WardIssuesRoute from '../../src/pages/curator/ward/[id]/issues.astro';

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

// High, task-specific ward ids (Task 39 brief) —
// tests/unit/ward-issues.test.ts owns 99493-99494; this
// route suite owns 99495-99499.
const WARD_COMPLETE = {
  id: 99495,
  nameEn: 'Curator Ward Route Test Ward Complete',
  nameKn: 'ಕ್ಯುರೇಟರ್ ವಾರ್ಡ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone CW',
  boundaryRef: 'curator-ward-route-test-complete',
};
const WARD_HELD = {
  id: 99496,
  nameEn: 'Curator Ward Route Test Ward Held',
  nameKn: 'ಕ್ಯುರೇಟರ್ ವಾರ್ಡ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಬಿ',
  corporation: 'south' as const,
  zone: 'Zone CW',
  boundaryRef: 'curator-ward-route-test-held',
};
const WARD_ISSUES = {
  id: 99498,
  nameEn: 'Curator Ward Route Test Ward Issues',
  nameKn: 'ಕ್ಯುರೇಟರ್ ವಾರ್ಡ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಡಿ',
  corporation: 'south' as const,
  zone: 'Zone CW',
  boundaryRef: 'curator-ward-route-test-issues',
};
const WARD_CSRF = {
  id: 99499,
  nameEn: 'Curator Ward Route Test Ward CSRF',
  nameKn: 'ಕ್ಯುರೇಟರ್ ವಾರ್ಡ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಇ',
  corporation: 'south' as const,
  zone: 'Zone CW',
  boundaryRef: 'curator-ward-route-test-csrf',
};
const ALL_WARDS = [WARD_COMPLETE, WARD_HELD, WARD_ISSUES, WARD_CSRF];

const EMAILS = { curator: 'curator-ward-route-test-curator@example.com' };
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
  params?: Record<string, string>;
}

async function run(component: unknown, path: string, opts: RunOptions = {}): Promise<Response> {
  const { method = 'GET', cookieValue, form, secFetchSite = 'same-origin', params } = opts;
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
      params,
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

async function insertCandidate(wardId: number, overrides: Partial<typeof schema.candidates.$inferInsert> = {}): Promise<number> {
  const [row] = await db
    .insert(schema.candidates)
    .values({
      slug: `curator-ward-route-test-${wardId}-${Math.random().toString(36).slice(2)}`,
      wardId,
      nameEn: 'Curator Ward Route Test Candidate',
      partyEn: 'Independent',
      status: 'contesting',
      ...overrides,
    })
    .returning({ id: schema.candidates.id });
  return row!.id;
}

let curatorId: number;
let curatorAuth: { cookieValue: string; token: string };

async function resetFixtures(): Promise<void> {
  const candidateRows = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(inArray(schema.candidates.wardId, ALL_WARDS.map((w) => w.id)));
  const candidateIds = candidateRows.map((r) => r.id);
  if (candidateIds.length > 0) {
    await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
  }
  await db.delete(schema.candidates).where(inArray(schema.candidates.wardId, ALL_WARDS.map((w) => w.id)));

  const issueRows = await db
    .select({ id: schema.wardIssues.id })
    .from(schema.wardIssues)
    .where(inArray(schema.wardIssues.wardId, ALL_WARDS.map((w) => w.id)));
  const issueIds = issueRows.map((r) => r.id);
  if (issueIds.length > 0) {
    await db.delete(schema.issueVoteSelections).where(inArray(schema.issueVoteSelections.wardIssueId, issueIds));
  }
  await db.delete(schema.wardIssues).where(inArray(schema.wardIssues.wardId, ALL_WARDS.map((w) => w.id)));
  if (typeof curatorId === 'number') {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, curatorId));
  }
}

describe('/curator/ward/{id}, /curator/ward/{id}/issues (Task 39)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    curatorId = await upsertUser(EMAILS.curator, 'curator');
    await resetFixtures();

    curatorAuth = await sessionFor(curatorId);

    // A candidate with missing fields — the ward page must not report on it.
    await insertCandidate(WARD_HELD.id, { nameEn: 'Held Ward Candidate' });
  });

  afterAll(async () => {
    await resetFixtures();
    await db.delete(schema.users).where(inArray(schema.users.email, Object.values(EMAILS)));
    await client.end();
  });

  describe('ward access', () => {
    it('GET a ward -> 200, no-store', async () => {
      const res = await run(WardEditRoute, `/curator/ward/${WARD_COMPLETE.id}`, {
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_COMPLETE.id) },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('GET an unknown ward id -> 404', async () => {
      const res = await run(WardEditRoute, '/curator/ward/999999999', {
        cookieValue: curatorAuth.cookieValue,
        params: { id: '999999999' },
      });
      expect(res.status).toBe(404);
    });

    it('GET a non-numeric ward id -> 404', async () => {
      const res = await run(WardEditRoute, '/curator/ward/not-a-number', {
        cookieValue: curatorAuth.cookieValue,
        params: { id: 'not-a-number' },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('no readiness panel or sign-off', () => {
    it('the ward page shows no readiness badge, gap list or sign-off form', async () => {
      const res = await run(WardEditRoute, `/curator/ward/${WARD_HELD.id}`, {
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_HELD.id) },
      });
      expect(res.status).toBe(200);
      const html = normalize(await res.text());

      expect(html).toContain(WARD_HELD.nameEn);
      expect(html).not.toContain('badge-chip--ward-ready');
      expect(html).not.toContain('badge-chip--ward-held');
      expect(html).not.toContain('value="sign_off"');
      expect(html).not.toContain('Held Ward Candidate');
      expect(html).toContain(`/curator/ward/${WARD_HELD.id}/issues`);
    });

    it('POST formAction=sign_off -> 400 (the action no longer exists)', async () => {
      const form = formWithToken({ formAction: 'sign_off' }, curatorAuth.token);
      const res = await run(WardEditRoute, `/curator/ward/${WARD_COMPLETE.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_COMPLETE.id) },
        form,
      });
      expect(res.status).toBe(400);
    });

    it('POST without the CSRF token -> 403', async () => {
      const fd = new FormData();
      fd.set('formAction', 'sign_off');

      const res = await run(WardEditRoute, `/curator/ward/${WARD_CSRF.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_CSRF.id) },
        form: fd,
      });
      expect(res.status).toBe(403);
    });
  });

  describe('ward issues editor', () => {
    it('add form creates a new issue', async () => {
      const form = formWithToken({ formAction: 'add', titleEn: 'Roads' }, curatorAuth.token);
      const res = await run(WardIssuesRoute, `/curator/ward/${WARD_ISSUES.id}/issues`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_ISSUES.id) },
        form,
      });
      expect(res.status).toBe(302);

      const [issue] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.wardId, WARD_ISSUES.id));
      expect(issue?.titleEn).toBe('Roads');
    });

    it('rename form updates the title, id unchanged', async () => {
      const [issue] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.wardId, WARD_ISSUES.id));
      const issueId = issue!.id;

      const form = formWithToken({ formAction: `rename:${issueId}`, titleEn: 'Roads and potholes' }, curatorAuth.token);
      const res = await run(WardIssuesRoute, `/curator/ward/${WARD_ISSUES.id}/issues`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_ISSUES.id) },
        form,
      });
      expect(res.status).toBe(302);

      const [renamed] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.id, issueId));
      expect(renamed?.id).toBe(issueId);
      expect(renamed?.titleEn).toBe('Roads and potholes');
    });

    it('remove form (with confirmation) deletes the issue', async () => {
      const [issue] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.wardId, WARD_ISSUES.id));
      const issueId = issue!.id;

      const form = formWithToken(
        { formAction: `remove:${issueId}`, confirmRemove: 'on' },
        curatorAuth.token,
      );
      const res = await run(WardIssuesRoute, `/curator/ward/${WARD_ISSUES.id}/issues`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_ISSUES.id) },
        form,
      });
      expect(res.status).toBe(302);

      const [gone] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.id, issueId));
      expect(gone).toBeUndefined();
    });

    it('remove form WITHOUT confirmation -> 400, issue left in place', async () => {
      const form = formWithToken({ formAction: 'add', titleEn: 'Water supply' }, curatorAuth.token);
      await run(WardIssuesRoute, `/curator/ward/${WARD_ISSUES.id}/issues`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_ISSUES.id) },
        form,
      });
      const [issue] = await db
        .select()
        .from(schema.wardIssues)
        .where(and(eq(schema.wardIssues.wardId, WARD_ISSUES.id), eq(schema.wardIssues.titleEn, 'Water supply')));

      const removeForm = formWithToken({ formAction: `remove:${issue!.id}` }, curatorAuth.token);
      const res = await run(WardIssuesRoute, `/curator/ward/${WARD_ISSUES.id}/issues`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_ISSUES.id) },
        form: removeForm,
      });
      expect(res.status).toBe(400);

      const [stillThere] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.id, issue!.id));
      expect(stillThere).toBeDefined();
    });
  });
});
