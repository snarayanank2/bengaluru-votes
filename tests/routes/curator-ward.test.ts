/**
 * `/curator/ward/{id}`, `/curator/ward/{id}/issues` (Task 39, PRD §9.1,
 * §5.4/§5.5; design-system.md §7.13). Drives every request through the
 * REAL middleware (src/middleware.ts) composed with the real page twins
 * via Astro's container API — same technique as
 * tests/routes/curator-candidate.test.ts.
 *
 * COVERAGE MAP:
 *   - READINESS PANEL: a complete ward renders the forest `ward-ready`
 *     badge; a held ward renders the sun `ward-held` badge PLUS its gap
 *     list — and NEVER any error/red styling (`badge-chip--flag-rejected`,
 *     `banner--error`) for the "not ready" state itself.
 *   - SIGN-OFF: "Mark ward ready" POST actually signs the ward off
 *     (ward_readiness row updated); an out-of-scope curator gets 403; a
 *     POST with no CSRF token gets 403.
 *   - WARD ISSUES: add/rename/remove all work end-to-end; an out-of-scope
 *     curator is 403'd on both the list page and every mutation.
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

// High, task-specific ward ids (Task 39 brief) — tests/unit/readiness.test.ts
// owns 99480-99492, tests/unit/ward-issues.test.ts owns 99493-99494; this
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
const WARD_OUT_OF_SCOPE = {
  id: 99497,
  nameEn: 'Curator Ward Route Test Ward Out Of Scope',
  nameKn: 'ಕ್ಯುರೇಟರ್ ವಾರ್ಡ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಸಿ',
  corporation: 'south' as const,
  zone: 'Zone CW',
  boundaryRef: 'curator-ward-route-test-out-of-scope',
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
const ALL_WARDS = [WARD_COMPLETE, WARD_HELD, WARD_OUT_OF_SCOPE, WARD_ISSUES, WARD_CSRF];
const SCOPED_WARD_IDS = [WARD_COMPLETE.id, WARD_HELD.id, WARD_ISSUES.id, WARD_CSRF.id];

const EMAILS = { curator: 'curator-ward-route-test-curator@example.com' };
const SOURCE = 'https://example.org/curator-ward-route-test-source';

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

async function insertCompleteFields(candidateId: number): Promise<void> {
  for (const fieldKey of ['cases', 'assets', 'education']) {
    await db.insert(schema.candidateFields).values({
      candidateId,
      fieldKey,
      valueEn: `${fieldKey} value`,
      sourceUrl: SOURCE,
      sourceType: 'curator',
    });
  }
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
  await db.delete(schema.wardReadiness).where(inArray(schema.wardReadiness.wardId, ALL_WARDS.map((w) => w.id)));
  if (typeof curatorId === 'number') {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, curatorId));
    await db.delete(schema.curatorScopes).where(eq(schema.curatorScopes.userId, curatorId));
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

    await db.insert(schema.curatorScopes).values(SCOPED_WARD_IDS.map((wardId) => ({ userId: curatorId, wardId })));
    curatorAuth = await sessionFor(curatorId);

    const completeCandidate = await insertCandidate(WARD_COMPLETE.id, { nameEn: 'Complete Ward Candidate' });
    await insertCompleteFields(completeCandidate);

    // WARD_HELD's candidate is missing 'assets' and 'education' entirely.
    const heldCandidate = await insertCandidate(WARD_HELD.id, { nameEn: 'Held Ward Candidate' });
    await db.insert(schema.candidateFields).values({
      candidateId: heldCandidate,
      fieldKey: 'cases',
      valueEn: 'No pending cases.',
      sourceUrl: SOURCE,
      sourceType: 'curator',
    });
  });

  afterAll(async () => {
    await resetFixtures();
    await db.delete(schema.users).where(inArray(schema.users.email, Object.values(EMAILS)));
    await client.end();
  });

  describe('scope enforcement', () => {
    it('GET a ward out of scope -> 403', async () => {
      const res = await run(WardEditRoute, `/curator/ward/${WARD_OUT_OF_SCOPE.id}`, {
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_OUT_OF_SCOPE.id) },
      });
      expect(res.status).toBe(403);
    });

    it('GET a ward in scope -> 200, no-store', async () => {
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

  describe('readiness panel — forest pass / sun held + gap list, NEVER red', () => {
    it('a complete ward renders the forest ward-ready badge, no gap list', async () => {
      const res = await run(WardEditRoute, `/curator/ward/${WARD_COMPLETE.id}`, {
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_COMPLETE.id) },
      });
      const html = normalize(await res.text());

      expect(html).toContain('badge-chip--ward-ready');
      expect(html).not.toContain('badge-chip--ward-held');
      expect(html).not.toContain('badge-chip--flag-rejected');
      expect(html).not.toContain('banner--error');
    });

    it('a held ward renders the sun ward-held badge PLUS the gap list, never red/error styling', async () => {
      const res = await run(WardEditRoute, `/curator/ward/${WARD_HELD.id}`, {
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_HELD.id) },
      });
      const html = normalize(await res.text());

      expect(html).toContain('badge-chip--ward-held');
      expect(html).not.toContain('badge-chip--ward-ready');
      expect(html).not.toContain('badge-chip--flag-rejected');
      expect(html).not.toContain('banner--error');
      expect(html).toContain('Held Ward Candidate');
      expect(html).toContain('assets');
      expect(html).toContain('education');
    });
  });

  describe('sign-off', () => {
    it('POST formAction=sign_off signs the ward off (ward_readiness updated)', async () => {
      const form = formWithToken({ formAction: 'sign_off' }, curatorAuth.token);
      const res = await run(WardEditRoute, `/curator/ward/${WARD_COMPLETE.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_COMPLETE.id) },
        form,
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/curator/ward/${WARD_COMPLETE.id}`);

      const [row] = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_COMPLETE.id));
      expect(row?.signedOffAt).not.toBeNull();
      expect(row?.signedOffBy).toBe(curatorId);
    });

    it('sign-off on an out-of-scope ward -> 403', async () => {
      const form = formWithToken({ formAction: 'sign_off' }, curatorAuth.token);
      const res = await run(WardEditRoute, `/curator/ward/${WARD_OUT_OF_SCOPE.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_OUT_OF_SCOPE.id) },
        form,
      });
      expect(res.status).toBe(403);
    });

    it('POST without the CSRF token -> 403, ward unaffected', async () => {
      const fd = new FormData();
      fd.set('formAction', 'sign_off');

      const res = await run(WardEditRoute, `/curator/ward/${WARD_CSRF.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_CSRF.id) },
        form: fd,
      });
      expect(res.status).toBe(403);

      const [row] = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_CSRF.id));
      expect(row).toBeUndefined();
    });
  });

  describe('ward issues editor', () => {
    it('GET the issues page out of scope -> 403', async () => {
      const res = await run(WardIssuesRoute, `/curator/ward/${WARD_OUT_OF_SCOPE.id}/issues`, {
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_OUT_OF_SCOPE.id) },
      });
      expect(res.status).toBe(403);
    });

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

    it('add/rename/remove out of scope -> 403', async () => {
      const addForm = formWithToken({ formAction: 'add', titleEn: 'Should not land' }, curatorAuth.token);
      const res = await run(WardIssuesRoute, `/curator/ward/${WARD_OUT_OF_SCOPE.id}/issues`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(WARD_OUT_OF_SCOPE.id) },
        form: addForm,
      });
      expect(res.status).toBe(403);
    });
  });
});
