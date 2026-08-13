/**
 * `/curator`, `/curator/queue`, `/curator/queue/{id}` (Task 34,
 * information-architecture.md §5.1/§5.2/§5.3; PRD §6.1/§7/§9.1). Drives
 * every request through the REAL middleware (src/middleware.ts) composed
 * with the real page twin via Astro's container API, same technique as
 * tests/routes/account.test.ts — so this suite exercises the actual
 * session/role/CSRF/scope guards end to end, not just that a form happens
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
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { t } from '../../src/i18n';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { humanTargetLabel } from '../../src/lib/curator';
import { signOffWard } from '../../src/lib/readiness';
import { publishCandidateCore } from '../../src/lib/publish';
import { onRequest } from '../../src/middleware';

import CuratorIndex from '../../src/pages/curator/index.astro';
import QueueIndex from '../../src/pages/curator/queue/index.astro';
import QueueItemRoute from '../../src/pages/curator/queue/[id].astro';

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

// High, task-specific ward ids (Task 34 brief) — other route suites own
// 94xxx-99332 (see tests/routes/account.test.ts's comment); this suite owns
// 99401-99404.
const WARD_A = {
  id: 99401,
  nameEn: 'Curator Route Test Ward A',
  nameKn: 'ಕ್ಯುರೇಟರ್ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'curator-route-test-ward-a',
};
const WARD_B_OUT_OF_SCOPE = {
  id: 99402,
  nameEn: 'Curator Route Test Ward B Out Of Scope',
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
const ALL_WARDS = [WARD_A, WARD_B_OUT_OF_SCOPE, WARD_D_NEVER_SIGNED_OFF, WARD_E_FULLY_SIGNED_OFF];
const SCOPED_WARD_IDS = [WARD_A.id, WARD_D_NEVER_SIGNED_OFF.id, WARD_E_FULLY_SIGNED_OFF.id];

const EMAILS = {
  curator: 'curator-route-test-curator@example.com',
  citizen: 'curator-route-test-citizen@example.com',
  submitterA: 'curator-route-test-submitter-a@example.com',
  submitterB: 'curator-route-test-submitter-b@example.com',
  admin: 'curator-route-test-admin@example.com',
  emptyScopeCurator: 'curator-route-test-empty-scope-curator@example.com',
};

/** Strips container-API debug attributes and collapses whitespace (see tests/routes/account.test.ts). */
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

/** Drives a request through the REAL middleware and the real page twin — same technique as tests/routes/account.test.ts's `run`, plus dynamic-route `params` passthrough (tests/routes/ward.test.ts). */
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
  role: 'citizen' | 'curator' | 'admin',
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
  submitterIds: number[],
): Promise<{ id: number; targetRef: string }> {
  const targetRef = `candidate:${candidateId}:${fieldKey}`;
  const [item] = await db
    .insert(schema.flagItems)
    .values({ wardId, targetType: 'candidate_field', targetRef, status: 'pending' })
    .returning({ id: schema.flagItems.id });
  for (const userId of submitterIds) {
    await db.insert(schema.flagSubmissions).values({
      flagItemId: item!.id,
      userId,
      detail: `Curator route test flag detail for ${targetRef}`,
    });
  }
  return { id: item!.id, targetRef };
}

let curatorId: number;
let citizenId: number;
let submitterAId: number;
let submitterBId: number;
let adminId: number; // role 'admin', NO curator_scopes rows — sees every ward (Gap 2)
let emptyScopeCuratorId: number; // role 'curator', ZERO curator_scopes rows — the []-is-not-null sentinel (Gap 2)
let curatorAuth: { cookieValue: string; token: string };
let citizenAuth: { cookieValue: string; token: string };
let adminAuth: { cookieValue: string; token: string };
let emptyScopeCuratorAuth: { cookieValue: string; token: string };

let candidateA: number; // in WARD_A — hosts every accept/reject fixture field below
let candidateB: number; // in WARD_B (out of scope)

let itemOutOfScope: { id: number; targetRef: string };
let itemDedupe: { id: number; targetRef: string }; // 2 submissions — dedupe count + also the accept-test target
let itemRejectEmpty: { id: number; targetRef: string };
let itemRejectValid: { id: number; targetRef: string };
let itemCsrf: { id: number; targetRef: string };
let itemAlreadyResolved: { id: number; targetRef: string };
let itemAcceptMissingSource: { id: number; targetRef: string };
let itemAcceptBadSource: { id: number; targetRef: string };

async function resetFixtures(): Promise<void> {
  const userIds = [curatorId, citizenId, submitterAId, submitterBId, adminId, emptyScopeCuratorId].filter(
    (v): v is number => typeof v === 'number',
  );
  if (userIds.length > 0) {
    await db.delete(schema.flagSubmissions).where(inArray(schema.flagSubmissions.userId, userIds));
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
    await db.delete(schema.curatorScopes).where(inArray(schema.curatorScopes.userId, userIds));
  }
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
  await db.delete(schema.wardReadiness).where(inArray(schema.wardReadiness.wardId, ALL_WARDS.map((w) => w.id)));
}

/** Final teardown only — drops the fixture user rows themselves (resetFixtures leaves them in place since their ids are reused stably across a beforeAll/afterAll pair). */
async function deleteFixtureUsers(): Promise<void> {
  await db.delete(schema.users).where(inArray(schema.users.email, Object.values(EMAILS)));
}

describe('/curator, /curator/queue, /curator/queue/{id} (Task 34) — IA §5.1/§5.2/§5.3', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    // Stable ids across runs (email upsert) — resolve them FIRST, then wipe
    // any stale flag/candidate/scope rows a PRIOR run left behind under
    // these same ids, before inserting this run's fresh fixtures.
    curatorId = await upsertUser(EMAILS.curator, 'curator');
    citizenId = await upsertUser(EMAILS.citizen, 'citizen');
    submitterAId = await upsertUser(EMAILS.submitterA, 'citizen');
    submitterBId = await upsertUser(EMAILS.submitterB, 'citizen');
    adminId = await upsertUser(EMAILS.admin, 'admin');
    emptyScopeCuratorId = await upsertUser(EMAILS.emptyScopeCurator, 'curator');
    await resetFixtures();

    // Curator scoped to WARD_A, WARD_D, WARD_E — NOT WARD_B (the
    // out-of-scope test's whole point). Deliberately NO curator_scopes rows
    // for adminId (admin ignores scope entirely, src/lib/curator.ts's
    // `scopedWardIds` returns `null` for it) or for emptyScopeCuratorId
    // (zero rows -> `[]`, the "in scope for nothing" sentinel, Gap 2).
    await db.insert(schema.curatorScopes).values([
      { userId: curatorId, wardId: WARD_A.id },
      { userId: curatorId, wardId: WARD_D_NEVER_SIGNED_OFF.id },
      { userId: curatorId, wardId: WARD_E_FULLY_SIGNED_OFF.id },
    ]);

    curatorAuth = await sessionFor(curatorId);
    citizenAuth = await sessionFor(citizenId);
    adminAuth = await sessionFor(adminId);
    emptyScopeCuratorAuth = await sessionFor(emptyScopeCuratorId);

    candidateA = await insertCandidate(WARD_A.id);
    candidateB = await insertCandidate(WARD_B_OUT_OF_SCOPE.id);

    itemOutOfScope = await insertPendingItem(WARD_B_OUT_OF_SCOPE.id, candidateB, 'cases', [submitterAId]);
    itemDedupe = await insertPendingItem(WARD_A.id, candidateA, 'cases', [submitterAId, submitterBId]);
    itemRejectEmpty = await insertPendingItem(WARD_A.id, candidateA, 'assets', [submitterAId]);
    itemRejectValid = await insertPendingItem(WARD_A.id, candidateA, 'education', [submitterAId]);
    itemCsrf = await insertPendingItem(WARD_A.id, candidateA, 'track_record', [submitterAId]);
    itemAlreadyResolved = await insertPendingItem(WARD_A.id, candidateA, 'approachability', [submitterAId]);
    itemAcceptMissingSource = await insertPendingItem(WARD_A.id, candidateA, 'net_worth', [submitterAId]);
    itemAcceptBadSource = await insertPendingItem(WARD_A.id, candidateA, 'contact_info', [submitterAId]);

    // WARD_A: produce a GENUINE "signed off, then cleared by a real
    // candidate-set change" ward_readiness row by driving it through the
    // actual write paths — src/lib/readiness.ts's `signOffWard`, then a
    // status flip via src/lib/publish.ts's `publishCandidateCore` (a
    // "candidate-set change", PRD §9.1) which clears the sign-off — rather
    // than hand-crafting a row with both `signedOffAt` and `clearedAt` set,
    // which those two functions never actually produce together
    // (mutually exclusive by construction — see readiness.ts's
    // `wasClearedByChange` docstring). A hand-crafted "both set" row is
    // exactly what let the dashboard's old, broken formula pass unnoticed.
    await signOffWard({ userId: curatorId, role: 'curator' }, WARD_A.id);
    await publishCandidateCore({ userId: curatorId, role: 'curator' }, { candidateId: candidateA, status: 'contesting' });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.insert(schema.wardReadiness).values([
      // Fully signed off, never cleared — must NOT appear in the
      // awaiting-sign-off list at all.
      { wardId: WARD_E_FULLY_SIGNED_OFF.id, signedOffAt: yesterday, clearedAt: null },
      // WARD_D gets no ward_readiness row at all — "never signed off" is
      // the other awaiting-sign-off case (no row == needs sign-off).
    ]);
  });

  afterAll(async () => {
    await resetFixtures();
    await deleteFixtureUsers();
    await client.end();
  });

  describe('scope enforcement — out-of-scope invisible (the core test)', () => {
    it('a pending flag_item in an out-of-scope ward never appears in /curator/queue, and 403s at /curator/queue/{id}', async () => {
      const queueRes = await run(QueueIndex, '/curator/queue', { cookieValue: curatorAuth.cookieValue });
      expect(queueRes.status).toBe(200);
      const html = normalize(await queueRes.text());

      expect(html).not.toContain(humanTargetLabel('candidate_field', itemOutOfScope.targetRef));
      expect(html).not.toContain(WARD_B_OUT_OF_SCOPE.nameEn);

      // In-scope items ARE listed, including the dedupe count.
      expect(html).toContain(
        `<td>${WARD_A.nameEn}</td><td>${humanTargetLabel('candidate_field', itemDedupe.targetRef)}</td><td>2</td>`,
      );

      const itemRes = await run(QueueItemRoute, `/curator/queue/${itemOutOfScope.id}`, {
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemOutOfScope.id) },
      });
      expect(itemRes.status).toBe(403);
    });
  });

  describe('dashboard (IA §5.1)', () => {
    it('queue count matches pending items in scoped wards; cleared-by-change ward is called out first; fully-signed-off ward never appears', async () => {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.flagItems)
        .where(and(eq(schema.flagItems.status, 'pending'), inArray(schema.flagItems.wardId, SCOPED_WARD_IDS)));
      const expectedCount = Number(countRow?.count ?? 0);

      const res = await run(CuratorIndex, '/curator', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');

      const html = normalize(await res.text());
      expect(html).toContain(t('en', 'curator.dashboard.queueCount', { count: expectedCount }));

      const idxA = html.indexOf(WARD_A.nameEn);
      const idxD = html.indexOf(WARD_D_NEVER_SIGNED_OFF.nameEn);
      expect(idxA).toBeGreaterThan(-1);
      expect(idxD).toBeGreaterThan(-1);
      expect(idxA).toBeLessThan(idxD); // cleared-by-change ward (WARD_A) called out first

      // The cleared-by-change flag itself must actually be true for WARD_A
      // (not just "sorted first by coincidence") — the "was signed off, now
      // cleared" note (curator.dashboard.signOff.clearedNote) renders right
      // next to WARD_A's row, and must NOT render next to WARD_D's (which
      // was simply never signed off — a different state entirely).
      const clearedNote = t('en', 'curator.dashboard.signOff.clearedNote');
      const idxClearedNote = html.indexOf(clearedNote);
      expect(idxClearedNote).toBeGreaterThan(-1);
      expect(idxClearedNote).toBeGreaterThan(idxA);
      expect(idxClearedNote).toBeLessThan(idxD);
      expect(html.indexOf(clearedNote, idxD)).toBe(-1); // no second occurrence after WARD_D's row

      expect(html).not.toContain(WARD_E_FULLY_SIGNED_OFF.nameEn); // fully signed off — excluded entirely
    });
  });

  describe('accept publishes + audits (PRD §6.1 step 4-5)', () => {
    it('accepting a candidate_field flag publishes the field and marks the item accepted, atomically, with an audit row', async () => {
      const res = await run(QueueItemRoute, `/curator/queue/${itemDedupe.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemDedupe.id) },
        fields: {
          formAction: 'accept',
          valueEn: 'No pending cases (curator-corrected)',
          sourceUrl: 'https://example.org/curator-route-test-source',
          sourceType: 'curator',
          authoredLang: 'en',
          confirmPublish: 'on',
          [CSRF_FIELD_NAME]: curatorAuth.token,
        },
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/curator/queue');
      expect(res.headers.get('cache-control')).toBe('no-store');

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateA), eq(schema.candidateFields.fieldKey, 'cases')));
      expect(field?.valueEn).toBe('No pending cases (curator-corrected)');
      expect(field?.sourceUrl).toBe('https://example.org/curator-route-test-source');

      const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemDedupe.id));
      expect(item?.status).toBe('accepted');

      const auditRows = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, `${candidateA}:cases`)));
      expect(auditRows.some((r) => r.action === 'publish' && r.actorUserId === curatorId)).toBe(true);
    });

    it('accept without the confirmation checkbox -> validation error, nothing published', async () => {
      const res = await run(QueueItemRoute, `/curator/queue/${itemAlreadyResolved.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemAlreadyResolved.id) },
        fields: {
          formAction: 'accept',
          valueEn: 'Should not publish',
          sourceUrl: 'https://example.org/curator-route-test-unconfirmed',
          sourceType: 'curator',
          authoredLang: 'en',
          [CSRF_FIELD_NAME]: curatorAuth.token,
        },
      });
      expect(res.status).toBe(400);

      const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemAlreadyResolved.id));
      expect(item?.status).toBe('pending');
    });

    it('accept with sourceUrl MISSING -> validation error, item stays pending, field not published', async () => {
      const res = await run(QueueItemRoute, `/curator/queue/${itemAcceptMissingSource.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemAcceptMissingSource.id) },
        fields: {
          formAction: 'accept',
          valueEn: 'Should not publish (missing source)',
          sourceType: 'curator',
          authoredLang: 'en',
          confirmPublish: 'on',
          [CSRF_FIELD_NAME]: curatorAuth.token,
        },
      });
      expect(res.status).toBe(400);

      const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemAcceptMissingSource.id));
      expect(item?.status).toBe('pending');

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateA), eq(schema.candidateFields.fieldKey, 'net_worth')));
      expect(field).toBeUndefined();
    });

    it('accept with a NON-http(s) sourceUrl (javascript:) -> validation error, item stays pending, field not published', async () => {
      const res = await run(QueueItemRoute, `/curator/queue/${itemAcceptBadSource.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemAcceptBadSource.id) },
        fields: {
          formAction: 'accept',
          valueEn: 'Should not publish (bad scheme)',
          sourceUrl: 'javascript:alert(1)',
          sourceType: 'curator',
          authoredLang: 'en',
          confirmPublish: 'on',
          [CSRF_FIELD_NAME]: curatorAuth.token,
        },
      });
      expect(res.status).toBe(400);

      const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemAcceptBadSource.id));
      expect(item?.status).toBe('pending');

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateA), eq(schema.candidateFields.fieldKey, 'contact_info')));
      expect(field).toBeUndefined();
    });

    it('accept with a NON-http(s) sourceUrl (ftp:) -> validation error, item stays pending, field not published', async () => {
      const res = await run(QueueItemRoute, `/curator/queue/${itemAcceptBadSource.id}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(itemAcceptBadSource.id) },
        fields: {
          formAction: 'accept',
          valueEn: 'Should not publish (ftp scheme)',
          sourceUrl: 'ftp://x',
          sourceType: 'curator',
          authoredLang: 'en',
          confirmPublish: 'on',
          [CSRF_FIELD_NAME]: curatorAuth.token,
        },
      });
      expect(res.status).toBe(400);

      const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, itemAcceptBadSource.id));
      expect(item?.status).toBe('pending');

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateA), eq(schema.candidateFields.fieldKey, 'contact_info')));
      expect(field).toBeUndefined();
    });
  });

  describe('reject requires a reason (PRD §6.1 step 3)', () => {
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
      expect(res.headers.get('location')).toBe('/curator/queue');

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

  describe('admin all-wards + empty-scope curator (the []-vs-null security sentinel)', () => {
    it('admin (no curator_scopes rows at all) sees pending items across MULTIPLE wards, including one no curator_scopes row covers, and can open any of them directly', async () => {
      const queueRes = await run(QueueIndex, '/curator/queue', { cookieValue: adminAuth.cookieValue });
      expect(queueRes.status).toBe(200);
      const html = normalize(await queueRes.text());

      // WARD_B_OUT_OF_SCOPE has no curator_scopes row for ANY user — proves
      // admin's `null` sentinel is a real "no filter", not merely "whatever
      // the regular curator's scopes happen to include".
      expect(html).toContain(WARD_B_OUT_OF_SCOPE.nameEn);
      expect(html).toContain(humanTargetLabel('candidate_field', itemOutOfScope.targetRef));
      // AND a different ward's item, in the same response — genuinely
      // unfiltered across multiple wards, not a fluke of one row leaking.
      expect(html).toContain(WARD_A.nameEn);

      const itemRes = await run(QueueItemRoute, `/curator/queue/${itemOutOfScope.id}`, {
        cookieValue: adminAuth.cookieValue,
        params: { id: String(itemOutOfScope.id) },
      });
      expect(itemRes.status).toBe(200);
    });

    it('a curator with ZERO curator_scopes rows sees NO items (empty scope means nothing, not everything), and is 403d on direct item access', async () => {
      const queueRes = await run(QueueIndex, '/curator/queue', { cookieValue: emptyScopeCuratorAuth.cookieValue });
      expect(queueRes.status).toBe(200);
      const html = normalize(await queueRes.text());

      expect(html).not.toContain(WARD_A.nameEn);
      expect(html).not.toContain(WARD_B_OUT_OF_SCOPE.nameEn);
      expect(html).not.toContain(humanTargetLabel('candidate_field', itemOutOfScope.targetRef));

      const itemRes = await run(QueueItemRoute, `/curator/queue/${itemOutOfScope.id}`, {
        cookieValue: emptyScopeCuratorAuth.cookieValue,
        params: { id: String(itemOutOfScope.id) },
      });
      expect(itemRes.status).toBe(403);
    });
  });

  describe('role guard (src/middleware.ts, Task 26)', () => {
    it('a citizen hitting /curator -> 403', async () => {
      const res = await run(CuratorIndex, '/curator', { cookieValue: citizenAuth.cookieValue });
      expect(res.status).toBe(403);
    });
  });
});
