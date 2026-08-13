/**
 * `/curator/candidate/{id}` — the affidavit ingestion panel (Task 37;
 * information-architecture.md §5.4; PRD §5.2; architecture §6/§7/§13).
 * Drives every request through the REAL middleware + the real page twin,
 * same technique as tests/routes/curator-candidate.test.ts, but isolated in
 * its own file/ward-id range so mocking `src/lib/extract` and
 * `src/lib/affidavit-fetch` here can't leak into that suite's real-behavior
 * coverage of the core/field/photo forms.
 *
 * `extractAffidavitFields` and `fetchAffidavitFromEc` are both MOCKED —
 * this suite is about the ROUTE WIRING (upload vs. EC-link dispatch,
 * curator scope, CSRF), not the SSRF hardening (tests/unit/affidavit-fetch.test.ts)
 * or the extraction pipeline (tests/unit/extract.test.ts) themselves.
 *
 * COVERAGE MAP:
 *   - upload path: POSTing a PDF file stores it, creates a
 *     `candidate_affidavits` row with `originUrl: null`, and calls
 *     `extractAffidavitFields`.
 *   - EC-link path: POSTing `ecUrl` calls `fetchAffidavitFromEc` with that
 *     URL, stores its returned bytes, and creates a `candidate_affidavits`
 *     row with `originUrl` set to the pasted link.
 *   - validation: neither file nor url -> 400; both provided -> 400.
 *   - SCOPE: a curator not scoped to the candidate's ward -> 403.
 *   - CSRF: POST without the synchronizer token -> 403.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';

vi.mock('../../src/lib/extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/extract')>();
  return { ...actual, extractAffidavitFields: vi.fn(async () => {}) };
});

vi.mock('../../src/lib/affidavit-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/affidavit-fetch')>();
  return { ...actual, fetchAffidavitFromEc: vi.fn() };
});

import CandidateEditRoute from '../../src/pages/curator/candidate/[id].astro';
import { extractAffidavitFields } from '../../src/lib/extract';
import { fetchAffidavitFromEc } from '../../src/lib/affidavit-fetch';

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

// High, task-specific ward ids (Task 37 brief) — this suite owns 99450-99451.
const WARD_A = {
  id: 99450,
  nameEn: 'Affidavit Test Ward A',
  nameKn: 'ಅಫಿಡವಿಟ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone Y',
  boundaryRef: 'affidavit-test-ward-a',
};
const WARD_OUT_OF_SCOPE = {
  id: 99451,
  nameEn: 'Affidavit Test Ward Out Of Scope',
  nameKn: 'ಅಫಿಡವಿಟ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಔಟ್',
  corporation: 'south' as const,
  zone: 'Zone Y',
  boundaryRef: 'affidavit-test-ward-out-of-scope',
};

const PDF_BYTES = Buffer.from('%PDF-1.4\nfake-affidavit-body-for-route-test\n%%EOF');

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

interface RunOptions {
  cookieValue?: string;
  form?: FormData;
  secFetchSite?: string | null;
  params?: Record<string, string>;
}

async function run(path: string, opts: RunOptions = {}): Promise<Response> {
  const { cookieValue, form, secFetchSite = 'same-origin', params } = opts;
  const url = new URL(path, SITE_URL);

  const headers = new Headers();
  if (cookieValue) headers.set('cookie', `${SESSION_COOKIE}=${cookieValue}`);
  if (secFetchSite) headers.set('sec-fetch-site', secFetchSite);

  const request = new Request(url, { method: 'POST', headers, body: form });

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

function affidavitForm(fields: Record<string, string>, token: string): FormData {
  const fd = new FormData();
  fd.set('formAction', 'affidavit');
  fd.set(CSRF_FIELD_NAME, token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
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

let curatorId: number;
let curatorAuth: { cookieValue: string; token: string };
let candidateA: number;
let candidateOutOfScope: number;

async function resetFixtures(): Promise<void> {
  if (typeof curatorId === 'number') {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, curatorId));
    await db.delete(schema.curatorScopes).where(eq(schema.curatorScopes.userId, curatorId));
  }
  const candidateIds = [candidateA, candidateOutOfScope].filter((v): v is number => typeof v === 'number');
  if (candidateIds.length > 0) {
    await db.delete(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.candidateId, candidateA));
  }
  await db.delete(schema.candidates).where(eq(schema.candidates.wardId, WARD_A.id));
  await db.delete(schema.candidates).where(eq(schema.candidates.wardId, WARD_OUT_OF_SCOPE.id));
}

describe('/curator/candidate/{id} — affidavit ingestion (Task 37)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of [WARD_A, WARD_OUT_OF_SCOPE]) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    curatorId = await upsertUser('affidavit-test-curator@example.com');
    await resetFixtures();

    await db.insert(schema.curatorScopes).values({ userId: curatorId, wardId: WARD_A.id });
    curatorAuth = await sessionFor(curatorId);

    const [rowA] = await db
      .insert(schema.candidates)
      .values({ slug: 'affidavit-test-candidate-a', wardId: WARD_A.id, nameEn: 'Affidavit Test Candidate', partyEn: 'Independent' })
      .returning({ id: schema.candidates.id });
    candidateA = rowA!.id;

    const [rowOut] = await db
      .insert(schema.candidates)
      .values({ slug: 'affidavit-test-candidate-oos', wardId: WARD_OUT_OF_SCOPE.id, nameEn: 'Out Of Scope Candidate', partyEn: 'Independent' })
      .returning({ id: schema.candidates.id });
    candidateOutOfScope = rowOut!.id;
  });

  afterAll(async () => {
    await resetFixtures();
    await db.delete(schema.users).where(eq(schema.users.email, 'affidavit-test-curator@example.com'));
    await client.end();
  });

  it('upload path: stores the PDF, creates a candidate_affidavits row (originUrl null), triggers extraction', async () => {
    const extractMock = vi.mocked(extractAffidavitFields);
    extractMock.mockClear();
    extractMock.mockResolvedValueOnce(undefined);

    const fd = affidavitForm({}, curatorAuth.token);
    fd.set('affidavitFile', new File([PDF_BYTES], 'affidavit.pdf', { type: 'application/pdf' }));

    const res = await run(`/curator/candidate/${candidateA}`, { cookieValue: curatorAuth.cookieValue, params: { id: String(candidateA) }, form: fd });
    expect(res.status).toBe(302);

    const [affidavitRow] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.candidateId, candidateA));
    expect(affidavitRow).toBeDefined();
    expect(affidavitRow!.originUrl).toBeNull();
    expect(affidavitRow!.extractionStatus).toBe('pending'); // route inserts pending; extraction outcome mocked separately

    const [mediaRow] = await db.select().from(schema.media).where(eq(schema.media.id, affidavitRow!.mediaId));
    expect(mediaRow!.contentType).toBe('application/pdf');

    expect(extractMock).toHaveBeenCalledTimes(1);
    expect(extractMock).toHaveBeenCalledWith(affidavitRow!.mediaId, candidateA, { userId: curatorId });
  });

  it('EC-link path: calls fetchAffidavitFromEc with the pasted URL, stores its result, originUrl set to the link', async () => {
    const fetchMock = vi.mocked(fetchAffidavitFromEc);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(PDF_BYTES);
    const extractMock = vi.mocked(extractAffidavitFields);
    extractMock.mockClear();
    extractMock.mockResolvedValueOnce(undefined);

    const ecUrl = 'https://eci.gov.in/affidavit-route-test.pdf';
    const fd = affidavitForm({ ecUrl }, curatorAuth.token);

    const res = await run(`/curator/candidate/${candidateA}`, { cookieValue: curatorAuth.cookieValue, params: { id: String(candidateA) }, form: fd });
    expect(res.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledWith(ecUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [affidavitRow] = await db
      .select()
      .from(schema.candidateAffidavits)
      .where(and(eq(schema.candidateAffidavits.candidateId, candidateA), eq(schema.candidateAffidavits.originUrl, ecUrl)));
    expect(affidavitRow).toBeDefined();
  });

  it('an SSRF-rejected EC link -> 400, no candidate_affidavits/media row created', async () => {
    const fetchMock = vi.mocked(fetchAffidavitFromEc);
    fetchMock.mockClear();
    fetchMock.mockRejectedValueOnce(new Error('ssrf_host'));

    const beforeRows = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.candidateId, candidateA));

    const fd = affidavitForm({ ecUrl: 'https://evil.example/affidavit.pdf' }, curatorAuth.token);
    const res = await run(`/curator/candidate/${candidateA}`, { cookieValue: curatorAuth.cookieValue, params: { id: String(candidateA) }, form: fd });
    expect(res.status).toBe(400);

    const afterRows = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.candidateId, candidateA));
    expect(afterRows.length).toBe(beforeRows.length);
  });

  it('neither file nor url provided -> 400 validation error', async () => {
    const fd = affidavitForm({}, curatorAuth.token);
    const res = await run(`/curator/candidate/${candidateA}`, { cookieValue: curatorAuth.cookieValue, params: { id: String(candidateA) }, form: fd });
    expect(res.status).toBe(400);
  });

  it('both file AND url provided -> 400 validation error', async () => {
    const fd = affidavitForm({ ecUrl: 'https://eci.gov.in/x.pdf' }, curatorAuth.token);
    fd.set('affidavitFile', new File([PDF_BYTES], 'affidavit.pdf', { type: 'application/pdf' }));
    const res = await run(`/curator/candidate/${candidateA}`, { cookieValue: curatorAuth.cookieValue, params: { id: String(candidateA) }, form: fd });
    expect(res.status).toBe(400);
  });

  it('curator out of scope for the candidate\'s ward -> 403', async () => {
    const fd = affidavitForm({}, curatorAuth.token);
    fd.set('affidavitFile', new File([PDF_BYTES], 'affidavit.pdf', { type: 'application/pdf' }));

    const res = await run(`/curator/candidate/${candidateOutOfScope}`, {
      cookieValue: curatorAuth.cookieValue,
      params: { id: String(candidateOutOfScope) },
      form: fd,
    });
    expect(res.status).toBe(403);
  });

  it('CSRF: POST without the synchronizer token -> 403', async () => {
    const fd = new FormData();
    fd.set('formAction', 'affidavit');
    fd.set('affidavitFile', new File([PDF_BYTES], 'affidavit.pdf', { type: 'application/pdf' }));

    const res = await run(`/curator/candidate/${candidateA}`, { cookieValue: curatorAuth.cookieValue, params: { id: String(candidateA) }, form: fd });
    expect(res.status).toBe(403);
  });
});
