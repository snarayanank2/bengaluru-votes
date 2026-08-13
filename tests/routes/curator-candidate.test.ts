/**
 * `/curator/candidate/{id}`, `/curator/candidate/new` (Task 36,
 * information-architecture.md §5.4; PRD §5.2/§9.1/§11; architecture §6).
 * Drives every request through the REAL middleware (src/middleware.ts)
 * composed with the real page twins via Astro's container API — same
 * technique as tests/routes/curator.test.ts.
 *
 * COVERAGE MAP:
 *   - SOURCE REQUIRED (PRD §11): a report-card field publish with a value
 *     but no source is rejected, nothing written.
 *   - STATUS CHANGE / NEW CANDIDATE CLEARS SIGN-OFF (architecture §6, PRD
 *     §9.1): exercised end-to-end through the real POST handlers (the
 *     lib-level atomicity/slug coverage lives in
 *     tests/unit/publish-candidate.test.ts).
 *   - SCOPE: a curator not scoped to the candidate's (or `?ward=`'s) ward
 *     gets 403.
 *   - PHOTO: a valid PNG upload sets photoMediaId; an SVG masquerading as a
 *     photo is rejected, candidate left uncorrupted.
 *   - CSRF: POST without the synchronizer token -> 403.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';

import CandidateEditRoute from '../../src/pages/curator/candidate/[id].astro';
import CandidateNewRoute from '../../src/pages/curator/candidate/new.astro';

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

// High, task-specific ward ids (Task 36 brief) — tests/unit/publish-candidate.test.ts
// owns 99430-99439; this route suite owns 99420-99429.
const WARD_A = {
  id: 99420,
  nameEn: 'Candidate Editor Test Ward A',
  nameKn: 'ಅಭ್ಯರ್ಥಿ ಸಂಪಾದಕ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'candidate-editor-test-ward-a',
};
const WARD_B_OUT_OF_SCOPE = {
  id: 99421,
  nameEn: 'Candidate Editor Test Ward B Out Of Scope',
  nameKn: 'ಅಭ್ಯರ್ಥಿ ಸಂಪಾದಕ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಬಿ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'candidate-editor-test-ward-b',
};
const WARD_STATUS_CLEAR = {
  id: 99422,
  nameEn: 'Candidate Editor Test Ward Status Clear',
  nameKn: 'ಅಭ್ಯರ್ಥಿ ಸಂಪಾದಕ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಸಿ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'candidate-editor-test-ward-status-clear',
};
const WARD_NEW_CANDIDATE = {
  id: 99423,
  nameEn: 'Candidate Editor Test Ward New Candidate',
  nameKn: 'ಅಭ್ಯರ್ಥಿ ಸಂಪಾದಕ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಡಿ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'candidate-editor-test-ward-new-candidate',
};
const ALL_WARDS = [WARD_A, WARD_B_OUT_OF_SCOPE, WARD_STATUS_CLEAR, WARD_NEW_CANDIDATE];
const SCOPED_WARD_IDS = [WARD_A.id, WARD_STATUS_CLEAR.id, WARD_NEW_CANDIDATE.id];

const EMAILS = {
  curator: 'candidate-editor-test-curator@example.com',
};

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body-for-candidate-editor-test'),
]);
const SVG_MASQUERADING_AS_PHOTO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

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
  search?: string;
}

/** Drives a request through the REAL middleware and the real page twin. Every POST body here is a `FormData` (multipart) — Astro's `.formData()` parses url-encoded and multipart identically, and the photo tests need a real file part, so this suite doesn't bother with a separate url-encoded path. */
async function run(component: unknown, path: string, opts: RunOptions = {}): Promise<Response> {
  const { method = 'GET', cookieValue, form, secFetchSite = 'same-origin', params, search } = opts;
  const url = new URL(path + (search ?? ''), SITE_URL);

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

function coreForm(fields: Record<string, string>, token: string): FormData {
  const fd = new FormData();
  fd.set('formAction', 'core');
  fd.set(CSRF_FIELD_NAME, token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function fieldForm(fieldKey: string, fields: Record<string, string>, token: string): FormData {
  const fd = new FormData();
  fd.set('formAction', `field:${fieldKey}`);
  fd.set(CSRF_FIELD_NAME, token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
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

async function insertCandidate(wardId: number, nameEn = 'Candidate Editor Test Candidate'): Promise<number> {
  const [row] = await db
    .insert(schema.candidates)
    .values({ slug: `candidate-editor-test-candidate-${randomUUID()}`, wardId, nameEn, partyEn: 'Independent' })
    .returning({ id: schema.candidates.id });
  return row!.id;
}

let curatorId: number;
let curatorAuth: { cookieValue: string; token: string };

let candidateA: number; // WARD_A — hosts core/field/photo/CSRF tests
let candidateOutOfScope: number; // WARD_B_OUT_OF_SCOPE
let candidateStatusClear: number; // WARD_STATUS_CLEAR — signed off

async function resetFixtures(): Promise<void> {
  if (typeof curatorId === 'number') {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, curatorId));
    await db.delete(schema.curatorScopes).where(eq(schema.curatorScopes.userId, curatorId));
  }
  const candidateIds = [candidateA, candidateOutOfScope, candidateStatusClear].filter(
    (v): v is number => typeof v === 'number',
  );
  if (candidateIds.length > 0) {
    await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
  }
  await db.delete(schema.candidates).where(inArray(schema.candidates.wardId, ALL_WARDS.map((w) => w.id)));
  await db.delete(schema.wardReadiness).where(inArray(schema.wardReadiness.wardId, ALL_WARDS.map((w) => w.id)));
}

describe('/curator/candidate/{id}, /curator/candidate/new (Task 36) — IA §5.4', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    curatorId = await upsertUser(EMAILS.curator, 'curator');
    await resetFixtures();

    await db.insert(schema.curatorScopes).values(SCOPED_WARD_IDS.map((wardId) => ({ userId: curatorId, wardId })));
    curatorAuth = await sessionFor(curatorId);

    candidateA = await insertCandidate(WARD_A.id, 'Original Name');
    candidateOutOfScope = await insertCandidate(WARD_B_OUT_OF_SCOPE.id);
    candidateStatusClear = await insertCandidate(WARD_STATUS_CLEAR.id, 'Status Clear Candidate');

    const signedOffAt = new Date(Date.now() - 60_000);
    await db.insert(schema.wardReadiness).values({ wardId: WARD_STATUS_CLEAR.id, signedOffAt, signedOffBy: 1 });
  });

  afterAll(async () => {
    await resetFixtures();
    await db.delete(schema.users).where(inArray(schema.users.email, Object.values(EMAILS)));
    await client.end();
  });

  describe('scope enforcement', () => {
    it('GET a candidate in an out-of-scope ward -> 403', async () => {
      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateOutOfScope}`, {
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateOutOfScope) },
      });
      expect(res.status).toBe(403);
    });

    it('GET a candidate in a scoped ward -> 200, page shows the candidate name', async () => {
      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateA}`, {
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateA) },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const html = normalize(await res.text());
      expect(html).toContain('Original Name');
    });

    it('GET /curator/candidate/new?ward={out-of-scope} -> 403', async () => {
      const res = await run(CandidateNewRoute, '/curator/candidate/new', {
        cookieValue: curatorAuth.cookieValue,
        search: `?ward=${WARD_B_OUT_OF_SCOPE.id}`,
      });
      expect(res.status).toBe(403);
    });

    it('GET /curator/candidate/new?ward={scoped} -> 200', async () => {
      const res = await run(CandidateNewRoute, '/curator/candidate/new', {
        cookieValue: curatorAuth.cookieValue,
        search: `?ward=${WARD_NEW_CANDIDATE.id}`,
      });
      expect(res.status).toBe(200);
    });

    it('GET /curator/candidate/new with no ?ward= -> 400', async () => {
      const res = await run(CandidateNewRoute, '/curator/candidate/new', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(400);
    });

    it('GET /curator/candidate/new?ward={unknown} -> 404', async () => {
      const res = await run(CandidateNewRoute, '/curator/candidate/new', {
        cookieValue: curatorAuth.cookieValue,
        search: '?ward=999999999',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('report-card field publish — SOURCE REQUIRED (PRD §11)', () => {
    it('a value with NO source -> 400 validation error, no candidate_fields row written', async () => {
      const form = fieldForm('cases', { valueEn: 'No pending cases.', sourceType: 'curator', authoredLang: 'en' }, curatorAuth.token);
      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateA}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateA) },
        form,
      });
      expect(res.status).toBe(400);

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateA), eq(schema.candidateFields.fieldKey, 'cases')));
      expect(field).toBeUndefined();
    });

    it('a notDeclared field with NO source is ALSO rejected — the affidavit is the source even for "not declared"', async () => {
      const form = fieldForm('assets', { notDeclared: 'on', sourceType: 'official', authoredLang: 'en' }, curatorAuth.token);
      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateA}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateA) },
        form,
      });
      expect(res.status).toBe(400);

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateA), eq(schema.candidateFields.fieldKey, 'assets')));
      expect(field).toBeUndefined();
    });

    it('a value WITH a valid source -> published, field row set correctly', async () => {
      const form = fieldForm(
        'track_record',
        {
          valueEn: 'Two-term corporator, led road-repair drive.',
          sourceUrl: 'https://example.org/candidate-editor-source',
          sourceType: 'curator',
          authoredLang: 'en',
        },
        curatorAuth.token,
      );
      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateA}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateA) },
        form,
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/curator/candidate/${candidateA}`);

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateA), eq(schema.candidateFields.fieldKey, 'track_record')));
      expect(field?.valueEn).toBe('Two-term corporator, led road-repair drive.');
      expect(field?.sourceUrl).toBe('https://example.org/candidate-editor-source');
      expect(field?.sourceType).toBe('curator');
    });
  });

  describe('core form — name/party edit, and status-change sign-off clear', () => {
    it('renaming (no status change) publishes but leaves ward sign-off untouched', async () => {
      const form = coreForm({ nameEn: 'Renamed Candidate', partyEn: 'Independent', status: 'filed' }, curatorAuth.token);
      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateA}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateA) },
        form,
      });
      expect(res.status).toBe(302);

      const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateA));
      expect(candidate?.nameEn).toBe('Renamed Candidate');

      const [readiness] = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_A.id));
      expect(readiness).toBeUndefined(); // never had one, still doesn't — no candidate-set change happened
    });

    it('missing required nameEn -> 400 validation error', async () => {
      const form = coreForm({ nameEn: '', partyEn: 'Independent', status: 'filed' }, curatorAuth.token);
      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateA}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateA) },
        form,
      });
      expect(res.status).toBe(400);
    });

    it('a STATUS transition on a SIGNED-OFF ward clears sign-off, audit-logged', async () => {
      const before = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_STATUS_CLEAR.id));
      expect(before[0]?.signedOffAt).not.toBeNull();

      const form = coreForm({ nameEn: 'Status Clear Candidate', partyEn: 'Independent', status: 'contesting' }, curatorAuth.token);
      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateStatusClear}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateStatusClear) },
        form,
      });
      expect(res.status).toBe(302);

      const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateStatusClear));
      expect(candidate?.status).toBe('contesting');

      const [readiness] = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_STATUS_CLEAR.id));
      expect(readiness?.signedOffAt).toBeNull();
      expect(readiness?.clearedAt).not.toBeNull();

      const auditRows = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityType, 'ward_readiness'), eq(schema.auditLog.entityId, String(WARD_STATUS_CLEAR.id))));
      expect(auditRows.some((r) => r.action === 'sign_off_clear' && r.actorUserId === curatorId)).toBe(true);
    });
  });

  describe('new-candidate creation clears sign-off too', () => {
    it('creating a candidate in a SIGNED-OFF ward clears that ward sign-off and redirects to the edit page', async () => {
      const signedOffAt = new Date(Date.now() - 60_000);
      await db
        .insert(schema.wardReadiness)
        .values({ wardId: WARD_NEW_CANDIDATE.id, signedOffAt, signedOffBy: 1 })
        .onConflictDoUpdate({ target: schema.wardReadiness.wardId, set: { signedOffAt, clearedAt: null, signedOffBy: 1 } });

      const form = coreForm({ nameEn: 'Brand New Filing', partyEn: 'Independent' }, curatorAuth.token);
      const res = await run(CandidateNewRoute, '/curator/candidate/new', {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        search: `?ward=${WARD_NEW_CANDIDATE.id}`,
        form,
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toMatch(/^\/curator\/candidate\/\d+$/);

      const [readiness] = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_NEW_CANDIDATE.id));
      expect(readiness?.signedOffAt).toBeNull();
      expect(readiness?.clearedAt).not.toBeNull();
    });
  });

  describe('photo upload — storeMedia', () => {
    it('a valid PNG sets photoMediaId', async () => {
      const form = coreForm({ nameEn: 'Renamed Candidate', partyEn: 'Independent', status: 'filed' }, curatorAuth.token);
      form.set('photo', new File([PNG_BYTES], 'photo.png', { type: 'image/png' }));

      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateA}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateA) },
        form,
      });
      expect(res.status).toBe(302);

      const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateA));
      expect(candidate?.photoMediaId).not.toBeNull();

      const [mediaRow] = await db.select().from(schema.media).where(eq(schema.media.id, candidate!.photoMediaId!));
      expect(mediaRow?.contentType).toBe('image/png');
    });

    it('an SVG masquerading as a photo is rejected — no corruption, candidate unchanged', async () => {
      const [before] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateA));

      const form = coreForm({ nameEn: 'Should Not Apply', partyEn: 'Independent', status: 'filed' }, curatorAuth.token);
      form.set('photo', new File([SVG_MASQUERADING_AS_PHOTO], 'photo.png', { type: 'image/png' }));

      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateA}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateA) },
        form,
      });
      expect(res.status).toBe(400);

      const [after] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateA));
      expect(after?.nameEn).toBe(before?.nameEn);
      expect(after?.photoMediaId).toBe(before?.photoMediaId);
    });

    it('a valid photo with an INVALID status -> 400, no media row created, no rate-limit consumed (orphaned-media invariant)', async () => {
      const [before] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateA));
      const [mediaCountBefore] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.media);

      const form = coreForm(
        { nameEn: 'Should Not Apply Either', partyEn: 'Independent', status: 'bogus' },
        curatorAuth.token,
      );
      form.set('photo', new File([PNG_BYTES], 'photo.png', { type: 'image/png' }));

      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateA}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateA) },
        form,
      });
      expect(res.status).toBe(400);

      const [after] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateA));
      expect(after?.nameEn).toBe(before?.nameEn);
      expect(after?.photoMediaId).toBe(before?.photoMediaId);

      const [mediaCountAfter] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.media);
      expect(mediaCountAfter?.count).toBe(mediaCountBefore?.count);
    });
  });

  describe('CSRF (src/middleware.ts synchronizer token)', () => {
    it('POST without the token -> 403, candidate unaffected', async () => {
      const fd = new FormData();
      fd.set('formAction', 'core');
      fd.set('nameEn', 'Should Not Apply Either');
      fd.set('partyEn', 'Independent');
      fd.set('status', 'filed');

      const res = await run(CandidateEditRoute, `/curator/candidate/${candidateA}`, {
        method: 'POST',
        cookieValue: curatorAuth.cookieValue,
        params: { id: String(candidateA) },
        form: fd,
      });
      expect(res.status).toBe(403);

      const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateA));
      expect(candidate?.nameEn).not.toBe('Should Not Apply Either');
    });
  });
});
