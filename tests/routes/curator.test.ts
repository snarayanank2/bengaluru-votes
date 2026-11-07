/**
 * `/curator`, `/curator/queue`, `/curator/queue/{id}` (Task 34;
 * architecture.md §7). Drives
 * every request through the REAL middleware (src/middleware.ts) composed
 * with the real page twin via Astro's container API, same technique as
 * tests/routes/curator-ward.test.ts — so this suite exercises the actual
 * session/role/CSRF guards end to end, not just that a form happens
 * to render a token.
 *
 * These routes have no `/kn/` twin (see src/middleware.ts's noindex list
 * and src/lib/curator.ts's module docstring) — every assertion here checks
 * the single English-language route twin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { t } from '../../src/i18n';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';

import CuratorIndex from '../../src/pages/curator/index.astro';
import QueueIndex from '../../src/pages/curator/queue/index.astro';
import QueueItemRoute from '../../src/pages/curator/queue/[id].astro';
import GuideRoute from '../../src/pages/curator/guide.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const SITE_URL = new URL(SITE_ORIGIN);

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward ids (Task 34 brief) — other route suites own
// 94xxx-99332 (see the other route suites' ward-id comments); this suite owns
// 99401-99404.
const WARD_A = {
  id: 99401,
  nameEn: 'Curator Route Test Ward A',
  nameKn: 'ಕ್ಯುರೇಟರ್ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'curator-route-test-ward-a',
};
const WARD_B = {
  id: 99402,
  nameEn: 'Curator Route Test Ward B',
  nameKn: 'ಕ್ಯುರೇಟರ್ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಬಿ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'curator-route-test-ward-b',
};
const WARD_D_NEVER_SIGNED_OFF = {
  id: 99403,
  nameEn: 'Curator Route Test Ward D Never Signed Off',
  nameKn: 'ಕ್ಯುರೇಟರ್ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಡಿ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'curator-route-test-ward-d',
};
const WARD_E_FULLY_SIGNED_OFF = {
  id: 99404,
  nameEn: 'Curator Route Test Ward E Fully Signed Off',
  nameKn: 'ಕ್ಯುರೇಟರ್ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಇ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'curator-route-test-ward-e',
};
const ALL_WARDS = [WARD_A, WARD_B, WARD_D_NEVER_SIGNED_OFF, WARD_E_FULLY_SIGNED_OFF];

const EMAILS = {
  curator: 'curator-route-test-curator@example.com',
  transcriber: 'curator-route-test-transcriber@example.com',
  admin: 'curator-route-test-admin@example.com',
};

/** Strips container-API debug attributes and collapses whitespace (see tests/routes/curator-ward.test.ts). */
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
  fields?: Record<string, string>;
  secFetchSite?: string | null;
  params?: Record<string, string>;
}

/** Drives a request through the REAL middleware and the real page twin — same technique as tests/routes/curator-ward.test.ts's `run`, plus dynamic-route `params` passthrough (tests/routes/ward.test.ts). */
async function run(component: unknown, path: string, opts: RunOptions = {}): Promise<Response> {
  const { method = 'GET', cookieValue, fields, secFetchSite = 'same-origin', params } = opts;
  const url = new URL(path, SITE_URL);

  const headers = new Headers();
  if (cookieValue) headers.set('cookie', `${SESSION_COOKIE}=${cookieValue}`);
  if (fields) headers.set('content-type', 'application/x-www-form-urlencoded');
  if (secFetchSite) headers.set('sec-fetch-site', secFetchSite);

  const body = fields ? new URLSearchParams(fields).toString() : undefined;
  const request = new Request(url, { method, headers, body });

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

async function sessionFor(userId: number): Promise<{ cookieValue: string; token: string }> {
  const { id, cookieValue } = await createSession(userId);
  return { cookieValue, token: issueCsrfToken(id) };
}

async function upsertUser(
  email: string,
  role: 'transcriber' | 'curator' | 'admin',
  extra: Partial<typeof schema.users.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(schema.users)
    .values({ email, role, status: 'active', ...extra })
    .onConflictDoUpdate({ target: schema.users.email, set: { role, status: 'active', ...extra } })
    .returning({ id: schema.users.id });
  return row!.id;
}

async function insertCandidate(wardId: number): Promise<number> {
  const [row] = await db
    .insert(schema.candidates)
    .values({
      slug: `curator-route-test-candidate-${randomUUID()}`,
      wardId,
      nameEn: 'Curator Route Test Candidate',
      partyEn: 'Independent',
    })
    .returning({ id: schema.candidates.id });
  return row!.id;
}

async function insertPendingItem(
  wardId: number,
  candidateId: number,
  fieldKey: string,
  submissions: number,
): Promise<{ id: number; targetRef: string }> {
  const targetRef = `candidate:${candidateId}:${fieldKey}`;
  const [item] = await db
    .insert(schema.flagItems)
    .values({ wardId, targetType: 'candidate_field', targetRef, status: 'pending' })
    .returning({ id: schema.flagItems.id });
  for (let i = 0; i < submissions; i += 1) {
    await db.insert(schema.flagSubmissions).values({
      flagItemId: item!.id,
      browserHash: randomUUID(),
      detail: `Curator route test flag detail for ${targetRef}`,
    });
  }
  return { id: item!.id, targetRef };
}

/** How the queue names a flag on a fixture candidate's cases: "{candidate} — {field label}". */
const CASES_LABEL = `Curator Route Test Candidate — ${t('en', 'candidate.field.cases')}`;
/** A ward as staff screens name it: its public number and name, never the stored "N - name" form or the route id. */
const wardCell = (ward: { id: number; nameEn: string }) => `Ward ${ward.id % 1000} ${ward.nameEn}`;

let curatorId: number;
let transcriberId: number;
let adminId: number;
let curatorAuth: { cookieValue: string; token: string };
let transcriberAuth: { cookieValue: string; token: string };
let adminAuth: { cookieValue: string; token: string };

let candidateA: number; // in WARD_A — hosts every reject fixture field below
let candidateB: number; // in WARD_B — a second ward, to prove the queue is city-wide

let itemWardB: { id: number; targetRef: string };
let itemDedupe: { id: number; targetRef: string }; // 2 submissions — the dedupe count
let itemRejectEmpty: { id: number; targetRef: string };
let itemRejectValid: { id: number; targetRef: string };
let itemCsrf: { id: number; targetRef: string };
let itemAlreadyResolved: { id: number; targetRef: string };

async function resetFixtures(): Promise<void> {
  const userIds = [curatorId, transcriberId, adminId].filter(
    (v): v is number => typeof v === 'number',
  );
  if (userIds.length > 0) {
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
  }
  await db.delete(schema.flagSubmissions).where(
    inArray(
      schema.flagSubmissions.flagItemId,
      db.select({ id: schema.flagItems.id }).from(schema.flagItems).where(inArray(schema.flagItems.wardId, ALL_WARDS.map((w) => w.id))),
    ),
  );
  await db.delete(schema.flagItems).where(inArray(schema.flagItems.wardId, ALL_WARDS.map((w) => w.id)));
  if (typeof candidateA === 'number' || typeof candidateB === 'number') {
    const candidateIds = [candidateA, candidateB].filter((v): v is number => typeof v === 'number');
    if (candidateIds.length > 0) {
      await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
    }
  }
  await db.delete(schema.candidates).where(
    inArray(
      schema.candidates.wardId,
      ALL_WARDS.map((w) => w.id),
    ),
  );
}

/** Final teardown only — drops the fixture user rows themselves (resetFixtures leaves them in place since their ids are reused stably across a beforeAll/afterAll pair). */
async function deleteFixtureUsers(): Promise<void> {
  await db.delete(schema.users).where(inArray(schema.users.email, Object.values(EMAILS)));
}

describe('/curator, /curator/queue, /curator/queue/{id} (Task 34)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    // Stable ids across runs (email upsert) — resolve them FIRST, then wipe
    // any stale flag/candidate rows a PRIOR run left behind under
    // these same ids, before inserting this run's fresh fixtures.
    curatorId = await upsertUser(EMAILS.curator, 'curator');
    transcriberId = await upsertUser(EMAILS.transcriber, 'transcriber');
    adminId = await upsertUser(EMAILS.admin, 'admin');
    await resetFixtures();

    curatorAuth = await sessionFor(curatorId);
    transcriberAuth = await sessionFor(transcriberId);
    adminAuth = await sessionFor(adminId);

    candidateA = await insertCandidate(WARD_A.id);
    candidateB = await insertCandidate(WARD_B.id);

    itemWardB = await insertPendingItem(WARD_B.id, candidateB, 'cases', 1);
    itemDedupe = await insertPendingItem(WARD_A.id, candidateA, 'cases', 2);
    itemRejectEmpty = await insertPendingItem(WARD_A.id, candidateA, 'assets', 1);
    itemRejectValid = await insertPendingItem(WARD_A.id, candidateA, 'education', 1);
    itemCsrf = await insertPendingItem(WARD_A.id, candidateA, 'track_record', 1);
    itemAlreadyResolved = await insertPendingItem(WARD_A.id, candidateA, 'approachability', 1);
  });

  afterAll(async () => {
    await resetFixtures();
    await deleteFixtureUsers();
    await client.end();
  });

  describe('city-wide queue — a curator has no ward assignment and sees every ward', () => {
    it('pending flag_items in different wards all appear in /curator/queue, and any of them opens at /curator/queue/{id}', async () => {
      const queueRes = await run(QueueIndex, '/curator/queue', { cookieValue: curatorAuth.cookieValue });
      expect(queueRes.status).toBe(200);
      const html = normalize(await queueRes.text());

      // Each row names the candidate and the flagged field, under the candidate's ward.
      expect(html).toContain(`<td>${wardCell(WARD_B)}</td><td>${CASES_LABEL}<span class="queue-when">`);
      expect(html).toContain('<td class="num">1<span class="queue-spam"><span class="queue-sep">·</span>0 spam</span></td>');

      // Including the dedupe count.
      expect(html).toContain(`<td>${wardCell(WARD_A)}</td><td>${CASES_LABEL}<span class="queue-when">`);
      expect(html).toContain('<td class="num">2<span class="queue-spam"><span class="queue-sep">·</span>0 spam</span></td>');

      // A row older than the fixed field set has no label: it reads "Other", never the stored reference.
      expect(html).toContain('Curator Route Test Candidate — Other');
      expect(html).not.toContain(itemCsrf.targetRef);

      const itemRes = await run(QueueItemRoute, `/curator/queue/${itemWardB.id}`, {
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemWardB.id) },
      });
      expect(itemRes.status).toBe(200);
    });
  });

  describe('dashboard', () => {
    it('queue count matches every pending item; there is no awaiting-sign-off list', async () => {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.flagItems)
        .where(eq(schema.flagItems.status, 'pending'));
      const expectedCount = Number(countRow?.count ?? 0);

      const res = await run(CuratorIndex, '/curator', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');

      const html = normalize(await res.text());
      // Singular and plural are separate strings; there is no "flag(s)" placeholder.
      expect(html).toContain(
        expectedCount === 1
          ? t('en', 'curator.dashboard.queueCountOne')
          : t('en', 'curator.dashboard.queueCount', { count: expectedCount }),
      );
      expect(html).not.toContain('flag(s)');

      expect(html).not.toContain('Awaiting sign-off');
      expect(html).not.toContain(WARD_D_NEVER_SIGNED_OFF.nameEn);
    });
  });

  describe('the form that is posted', () => {
    it('a formAction that is neither fix nor reject (the retired accept form) -> bare 400, nothing published, item stays pending', async () => {
      const res = await run(QueueItemRoute, `/curator/queue/${itemDedupe.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemDedupe.id) },
        fields: {
          formAction: 'accept',
          valueEn: 'Should not publish',
          sourceUrl: 'https://example.org/curator-route-test-source',
          confirmPublish: 'on',
          [CSRF_FIELD_NAME]: curatorAuth.token,
        },
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe('');

      const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemDedupe.id));
      expect(item?.status).toBe('pending');
      const fields = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateA));
      expect(fields).toHaveLength(0);
    });
  });

  describe('reject requires a reason', () => {
    it('empty reason -> 400 validation error, item stays pending', async () => {
      const res = await run(QueueItemRoute, `/curator/queue/${itemRejectEmpty.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemRejectEmpty.id) },
        fields: { formAction: 'reject', reason: '', [CSRF_FIELD_NAME]: curatorAuth.token },
      });
      expect(res.status).toBe(400);

      const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemRejectEmpty.id));
      expect(item?.status).toBe('pending');
    });

    it('a real reason -> item rejected, reason stored', async () => {
      const res = await run(QueueItemRoute, `/curator/queue/${itemRejectValid.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemRejectValid.id) },
        fields: { formAction: 'reject', reason: 'Not a valid correction.', [CSRF_FIELD_NAME]: curatorAuth.token },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/curator/queue?resolved=rejected');

      const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemRejectValid.id));
      expect(item?.status).toBe('rejected');
      expect(item?.resolutionReason).toBe('Not a valid correction.');
    });
  });

  describe('CSRF (src/middleware.ts synchronizer token)', () => {
    it('POST without the token -> 403, item unaffected; WITH the token -> succeeds', async () => {
      const withoutToken = await run(QueueItemRoute, `/curator/queue/${itemCsrf.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemCsrf.id) },
        fields: { formAction: 'reject', reason: 'Missing csrf token attempt.' },
      });
      expect(withoutToken.status).toBe(403);

      const [pendingStill] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemCsrf.id));
      expect(pendingStill?.status).toBe('pending');

      const withToken = await run(QueueItemRoute, `/curator/queue/${itemCsrf.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemCsrf.id) },
        fields: { formAction: 'reject', reason: 'Valid csrf token attempt.', [CSRF_FIELD_NAME]: curatorAuth.token },
      });
      expect(withToken.status).toBe(302);

      const [resolved] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemCsrf.id));
      expect(resolved?.status).toBe('rejected');
    });
  });

  describe('flag_already_resolved — friendly message, not a 500', () => {
    it('resolving an already-resolved item shows a friendly notice and leaves the first resolution intact', async () => {
      const first = await run(QueueItemRoute, `/curator/queue/${itemAlreadyResolved.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemAlreadyResolved.id) },
        fields: { formAction: 'reject', reason: 'First resolution.', [CSRF_FIELD_NAME]: curatorAuth.token },
      });
      expect(first.status).toBe(302);

      const second = await run(QueueItemRoute, `/curator/queue/${itemAlreadyResolved.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemAlreadyResolved.id) },
        fields: { formAction: 'reject', reason: 'Second, too-late attempt.', [CSRF_FIELD_NAME]: curatorAuth.token },
      });
      expect(second.status).toBe(200);
      expect(second.headers.get('cache-control')).toBe('no-store');
      const html = normalize(await second.text());
      expect(html).toContain(t('en', 'curator.queueItem.alreadyResolved'));

      const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemAlreadyResolved.id));
      expect(item?.status).toBe('rejected');
      expect(item?.resolutionReason).toBe('First resolution.'); // unchanged by the second, too-late attempt
    });
  });

  describe('admin all-wards', () => {
    it('admin sees pending items across MULTIPLE wards and can open any of them directly', async () => {
      const queueRes = await run(QueueIndex, '/curator/queue', { cookieValue: adminAuth.cookieValue });
      expect(queueRes.status).toBe(200);
      const html = normalize(await queueRes.text());

      expect(html).toContain(`<td>${wardCell(WARD_B)}</td><td>${CASES_LABEL}`);
      expect(html).toContain(WARD_A.nameEn);

      const itemRes = await run(QueueItemRoute, `/curator/queue/${itemWardB.id}`, {
        cookieValue: adminAuth.cookieValue,
        params: { id: String(itemWardB.id) },
      });
      expect(itemRes.status).toBe(200);
    });
  });

  describe('role guard (src/middleware.ts, Task 26)', () => {
    it('a transcriber hitting /curator -> 403', async () => {
      const res = await run(CuratorIndex, '/curator', { cookieValue: transcriberAuth.cookieValue });
      expect(res.status).toBe(403);
    });
  });

  describe('/curator/guide', () => {
    it('shows a curator the guide, uncached and unindexed', async () => {
      const res = await run(GuideRoute, '/curator/guide', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const html = await res.text();
      expect(html).toContain(t('en', 'curator.guide.heading'));
      expect(html).toContain(t('en', 'staff.entry.never.heading'));
      expect(html).toContain(t('en', 'curator.guide.matching.heading'));
      expect(html).toContain('<meta name="robots" content="noindex"');
    });

    it('refuses a transcriber', async () => {
      expect((await run(GuideRoute, '/curator/guide', { cookieValue: transcriberAuth.cookieValue })).status).toBe(403);
    });

    it('links to every section from the bar', async () => {
      const html = await (await run(GuideRoute, '/curator/guide', { cookieValue: curatorAuth.cookieValue })).text();
      for (const href of ['/curator/queue', '/curator/matching', '/curator/guide']) expect(html).toContain(`href="${href}"`);
    });
  });
});
