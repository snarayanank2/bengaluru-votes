/**
 * `/curator/candidate/{id}` — the news-links panel (Task 38; PRD §5.2;
 * architecture §7). Drives every request through the REAL middleware + the
 * real page twin, same technique as tests/routes/curator-candidate.test.ts
 * and tests/routes/curator-candidate-affidavit.test.ts, isolated in its own
 * ward-id range so it can't interfere with those suites.
 *
 * COVERAGE MAP:
 *   - ADD: posting url+title adds a curator-authored, directly-approved
 *     link; a non-http url -> 400, no insert; a duplicate url -> 400, no
 *     insert.
 *   - APPROVE: posting a suggested link's id flips it to approved.
 *   - RENDER: a GET on the editor shows a suggested link with its
 *     domain/approve button, and shows an already-approved link with its
 *     "approved" badge.
 *   - CURATOR-ONLY RENDER GUARD (the load-bearing check, re-run at the
 *     lib level in tests/unit/news.test.ts and again at the public
 *     report-card route in Task 42): the SAME data that renders on this
 *     curator-only editor page must NOT be returned by
 *     `listNewsLinks(id, { approvedOnly: true })` for a still-suggested
 *     link — proving the public path structurally cannot surface it.
 *   - SCOPE: a curator not scoped to the candidate's ward -> 403.
 *   - CSRF: POST without the synchronizer token -> 403.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';
import { listNewsLinks } from '../../src/lib/news';

import CandidateEditRoute from '../../src/pages/curator/candidate/[id].astro';

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

// High, task-specific ward ids (Task 38 brief) — tests/unit/news.test.ts
// owns 99460; this route suite owns 99470-99471.
const WARD_A = {
  id: 99470,
  nameEn: 'News Links Route Test Ward A',
  nameKn: 'ಸುದ್ದಿ ಲಿಂಕ್ ರೂಟ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'news-links-route-test-ward-a',
};
const WARD_OUT_OF_SCOPE = {
  id: 99471,
  nameEn: 'News Links Route Test Ward Out Of Scope',
  nameKn: 'ಸುದ್ದಿ ಲಿಂಕ್ ರೂಟ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಔಟ್',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'news-links-route-test-ward-out-of-scope',
};
const ALL_WARDS = [WARD_A, WARD_OUT_OF_SCOPE];

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

async function run(path: string, opts: RunOptions = {}): Promise<Response> {
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
    container.renderToResponse(CandidateEditRoute as any, {
      partial: false,
      params,
      request,
      locals: locals as unknown as App.Locals,
    });

  return (await onRequest(ctx, next)) as Response;
}

function newsLinkAddForm(fields: Record<string, string>, token: string): FormData {
  const fd = new FormData();
  fd.set('formAction', 'news_link_add');
  fd.set(CSRF_FIELD_NAME, token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function newsLinkApproveForm(linkId: number, token: string): FormData {
  const fd = new FormData();
  fd.set('formAction', 'news_link_approve');
  fd.set('linkId', String(linkId));
  fd.set(CSRF_FIELD_NAME, token);
  return fd;
}

async function sessionFor(userId: number): Promise<{ cookieValue: string; token: string }> {
  const { id, cookieValue } = await createSession(userId);
  return { cookieValue, token: issueCsrfToken(id) };
}

async function upsertUser(email: string): Promise<number> {
  const [row] = await db
    .insert(schema.users)
    .values({ email, role: 'curator', status: 'active' })
    .onConflictDoUpdate({ target: schema.users.email, set: { role: 'curator', status: 'active' } })
    .returning({ id: schema.users.id });
  return row!.id;
}

async function insertCandidate(wardId: number): Promise<number> {
  const [row] = await db
    .insert(schema.candidates)
    .values({ slug: `news-links-route-test-candidate-${randomUUID()}`, wardId, nameEn: 'News Links Route Test Candidate', partyEn: 'Independent' })
    .returning({ id: schema.candidates.id });
  return row!.id;
}

let curatorId: number;
let curatorAuth: { cookieValue: string; token: string };
let candidateA: number;
let candidateOutOfScope: number;

async function resetFixtures(): Promise<void> {
  if (typeof curatorId === 'number') {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, curatorId));
    await db.delete(schema.curatorScopes).where(eq(schema.curatorScopes.userId, curatorId));
  }
  // Delete news_links via a subquery on ward id (not the in-memory
  // candidateA/candidateOutOfScope vars) so this cleans up correctly even
  // when called BEFORE those are assigned (the first beforeAll call) or
  // after a previous failed run left rows behind.
  const wardIds = ALL_WARDS.map((w) => w.id);
  const wardCandidateIds = db.select({ id: schema.candidates.id }).from(schema.candidates).where(inArray(schema.candidates.wardId, wardIds));
  await db.delete(schema.candidateNewsLinks).where(inArray(schema.candidateNewsLinks.candidateId, wardCandidateIds));
  await db.delete(schema.candidates).where(inArray(schema.candidates.wardId, wardIds));
}

describe('/curator/candidate/{id} — news links (Task 38)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    curatorId = await upsertUser('news-links-test-curator@example.com');
    await resetFixtures();

    await db.insert(schema.curatorScopes).values({ userId: curatorId, wardId: WARD_A.id });
    curatorAuth = await sessionFor(curatorId);

    candidateA = await insertCandidate(WARD_A.id);
    candidateOutOfScope = await insertCandidate(WARD_OUT_OF_SCOPE.id);
  });

  afterAll(async () => {
    await resetFixtures();
    await db.delete(schema.users).where(eq(schema.users.email, 'news-links-test-curator@example.com'));
    await client.end();
  });

  it('ADD: posting a url+title adds a curator-authored, directly-approved link', async () => {
    const url = `https://news.example.org/route-add-${randomUUID()}`;
    const fd = newsLinkAddForm({ url, title: 'A neutral news story' }, curatorAuth.token);

    const res = await run(`/curator/candidate/${candidateA}`, {
      method: 'POST',
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateA) },
      form: fd,
    });
    expect(res.status).toBe(302);

    const [row] = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.url, url));
    expect(row).toBeDefined();
    expect(row!.candidateId).toBe(candidateA);
    expect(row!.origin).toBe('curator');
    expect(row!.status).toBe('approved');
    expect(row!.approvedBy).toBe(curatorId);
  });

  it('ADD: a non-http url -> 400 validation error, no row inserted', async () => {
    const before = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateA));

    const fd = newsLinkAddForm({ url: 'javascript:alert(1)', title: 'Evil link' }, curatorAuth.token);
    const res = await run(`/curator/candidate/${candidateA}`, {
      method: 'POST',
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateA) },
      form: fd,
    });
    expect(res.status).toBe(400);

    const html = await res.text();
    expect(normalize(html)).toContain('http:// or https://');

    const after = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateA));
    expect(after.length).toBe(before.length);
  });

  it('ADD: a duplicate url -> 400 validation error, no second row inserted', async () => {
    const url = `https://news.example.org/route-dup-${randomUUID()}`;
    const firstFd = newsLinkAddForm({ url, title: 'First add' }, curatorAuth.token);
    const firstRes = await run(`/curator/candidate/${candidateA}`, {
      method: 'POST',
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateA) },
      form: firstFd,
    });
    expect(firstRes.status).toBe(302);

    const secondFd = newsLinkAddForm({ url, title: 'Second add, same url' }, curatorAuth.token);
    const secondRes = await run(`/curator/candidate/${candidateA}`, {
      method: 'POST',
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateA) },
      form: secondFd,
    });
    expect(secondRes.status).toBe(400);

    const rows = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.url, url));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('First add');
  });

  it('RENDER: a suggested link shows its domain + an approve button; an approved link shows its "approved" badge', async () => {
    const suggestedUrl = `https://auto-suggested.example.org/render-${randomUUID()}`;
    const [suggested] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId: candidateA,
        url: suggestedUrl,
        title: 'Render Test Suggested Story',
        domain: 'auto-suggested.example.org',
        origin: 'auto',
        status: 'suggested',
      })
      .returning();

    const approvedUrl = `https://approved.example.org/render-${randomUUID()}`;
    await db.insert(schema.candidateNewsLinks).values({
      candidateId: candidateA,
      url: approvedUrl,
      title: 'Render Test Approved Story',
      domain: 'approved.example.org',
      origin: 'curator',
      status: 'approved',
      approvedBy: curatorId,
    });

    const res = await run(`/curator/candidate/${candidateA}`, {
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateA) },
    });
    expect(res.status).toBe(200);
    const html = normalize(await res.text());

    expect(html).toContain('Render Test Suggested Story');
    expect(html).toContain('auto-suggested.example.org');
    expect(html).toContain(`value="${suggested!.id}"`);
    expect(html).toContain('Render Test Approved Story');
    expect(html).toContain('approved.example.org');

    // THE CURATOR-ONLY RENDER GUARD (re-run at the lib level in
    // tests/unit/news.test.ts): the exact same suggested link rendered on
    // this curator-only page must NOT be returned by the public-facing
    // approvedOnly query — proving the public path structurally can't
    // surface it, independent of whether some future public page
    // remembers to filter.
    const publicView = await listNewsLinks(candidateA, { approvedOnly: true });
    const publicUrls = publicView.map((l) => l.url);
    const publicTitles = publicView.map((l) => l.title);
    expect(publicUrls).not.toContain(suggestedUrl);
    expect(publicTitles).not.toContain('Render Test Suggested Story');
    expect(publicUrls).toContain(approvedUrl);
  });

  it('APPROVE: posting a suggested link\'s id flips it to approved', async () => {
    const [suggested] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId: candidateA,
        url: `https://auto-suggested.example.org/approve-${randomUUID()}`,
        title: 'Approve Test Suggested Story',
        domain: 'auto-suggested.example.org',
        origin: 'auto',
        status: 'suggested',
      })
      .returning();

    const fd = newsLinkApproveForm(suggested!.id, curatorAuth.token);
    const res = await run(`/curator/candidate/${candidateA}`, {
      method: 'POST',
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateA) },
      form: fd,
    });
    expect(res.status).toBe(302);

    const [after] = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.id, suggested!.id));
    expect(after!.status).toBe('approved');
    expect(after!.approvedBy).toBe(curatorId);
  });

  it('SCOPE: a curator not scoped to the candidate\'s ward -> 403 (for both add and approve)', async () => {
    const addFd = newsLinkAddForm({ url: `https://news.example.org/scope-${randomUUID()}`, title: 'Scope test' }, curatorAuth.token);
    const addRes = await run(`/curator/candidate/${candidateOutOfScope}`, {
      method: 'POST',
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateOutOfScope) },
      form: addFd,
    });
    expect(addRes.status).toBe(403);

    const [suggested] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId: candidateOutOfScope,
        url: `https://auto-suggested.example.org/scope-${randomUUID()}`,
        title: 'Out of scope suggested story',
        domain: 'auto-suggested.example.org',
        origin: 'auto',
        status: 'suggested',
      })
      .returning();

    const approveFd = newsLinkApproveForm(suggested!.id, curatorAuth.token);
    const approveRes = await run(`/curator/candidate/${candidateOutOfScope}`, {
      method: 'POST',
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateOutOfScope) },
      form: approveFd,
    });
    expect(approveRes.status).toBe(403);
  });

  it('SCOPE HOP: approve an out-of-scope link via an in-scope URL -> 400 (the deeper scope-hop guard), link stays suggested', async () => {
    // Curator is scoped to WARD_A; candidateA is in WARD_A (in scope);
    // candidateOutOfScope is in WARD_OUT_OF_SCOPE (NOT in scope).
    // Seed a suggested link L belonging to candidateOutOfScope.
    const [outOfScopeLink] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId: candidateOutOfScope,
        url: `https://auto-suggested.example.org/scope-hop-${randomUUID()}`,
        title: 'Out of scope link for scope-hop test',
        domain: 'auto-suggested.example.org',
        origin: 'auto',
        status: 'suggested',
      })
      .returning();

    // POST an approve action to candidateA's editor URL (in scope) with linkId = L.
    // The candidateA URL access should succeed (200 GET), but the POST to approve
    // should hit the handleNewsLinkApprove's scope-hop guard (line 928:
    // link.candidateId !== candidateId), returning validation_error -> 400.
    const fd = newsLinkApproveForm(outOfScopeLink!.id, curatorAuth.token);
    const res = await run(`/curator/candidate/${candidateA}`, {
      method: 'POST',
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateA) },
      form: fd,
    });
    expect(res.status).toBe(400);

    // Verify link L is still 'suggested' (NOT approved — approvedBy is null).
    const [after] = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.id, outOfScopeLink!.id));
    expect(after!.status).toBe('suggested');
    expect(after!.approvedBy).toBeNull();
  });

  it('CSRF: POST without the synchronizer token -> 403 (for both add and approve)', async () => {
    const addFd = new FormData();
    addFd.set('formAction', 'news_link_add');
    addFd.set('url', `https://news.example.org/csrf-${randomUUID()}`);
    addFd.set('title', 'CSRF test');
    const addRes = await run(`/curator/candidate/${candidateA}`, {
      method: 'POST',
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateA) },
      form: addFd,
    });
    expect(addRes.status).toBe(403);

    const [suggested] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId: candidateA,
        url: `https://auto-suggested.example.org/csrf-${randomUUID()}`,
        title: 'CSRF test suggested story',
        domain: 'auto-suggested.example.org',
        origin: 'auto',
        status: 'suggested',
      })
      .returning();

    const approveFd = new FormData();
    approveFd.set('formAction', 'news_link_approve');
    approveFd.set('linkId', String(suggested!.id));
    const approveRes = await run(`/curator/candidate/${candidateA}`, {
      method: 'POST',
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateA) },
      form: approveFd,
    });
    expect(approveRes.status).toBe(403);
  });
});
