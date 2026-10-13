/**
 * `/admin/affidavits`: bulk upload, the needs-matching list and the failed
 * list. Every request goes through the real middleware and the real page
 * twin, as tests/routes/admin-users.test.ts does.
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
import type { AffidavitExtraction } from '../../src/lib/affidavit-extraction';

import AffidavitsRoute from '../../src/pages/admin/affidavits.astro';

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

// This suite owns ward ids 99460-99461.
const WARD = { id: 99460, nameEn: 'Admin Affidavits Test Ward', nameKn: 'ಪರೀಕ್ಷಾ ವಾರ್ಡ್', corporation: 'south' as const, zone: 'Zone T', boundaryRef: 'admin-affidavits-test-ward' };
const EMAILS = {
  admin: 'admin-affidavits-test-admin@example.com',
  curator: 'admin-affidavits-test-curator@example.com',
  transcriber: 'admin-affidavits-test-transcriber@example.com',
};

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

async function run(path: string, opts: { cookieValue?: string; form?: FormData } = {}): Promise<Response> {
  const url = new URL(path, SITE_URL);
  const headers = new Headers({ 'sec-fetch-site': 'same-origin' });
  if (opts.cookieValue) headers.set('cookie', `${SESSION_COOKIE}=${opts.cookieValue}`);
  const request = new Request(url, { method: opts.form ? 'POST' : 'GET', headers, body: opts.form });
  const cookiesStub = {
    get: (name: string) => (name === SESSION_COOKIE && opts.cookieValue ? { value: opts.cookieValue } : undefined),
  };
  const locals: Record<string, unknown> = {};
  const ctx = { request, url, site: SITE_URL, cookies: cookiesStub, locals } as any;
  const container = await makeContainer();
  const next = async () =>
    container.renderToResponse(AffidavitsRoute as any, { partial: false, request, locals: locals as unknown as App.Locals });
  return (await onRequest(ctx, next)) as Response;
}

async function sessionFor(userId: number) {
  const { id, cookieValue } = await createSession(userId);
  return { cookieValue, token: issueCsrfToken(id) };
}

async function upsertUser(email: string, role: 'admin' | 'curator' | 'transcriber'): Promise<number> {
  const [row] = await db
    .insert(schema.users)
    .values({ email, role })
    .onConflictDoUpdate({ target: schema.users.email, set: { role, status: 'active' } })
    .returning({ id: schema.users.id });
  return row.id;
}

function pdfFile(name = 'a.pdf'): File {
  return new File([Buffer.from(`%PDF-1.4 admin affidavits test ${randomUUID()}`)], name, { type: 'application/pdf' });
}

function form(token: string, fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set(CSRF_FIELD_NAME, token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function extraction(name: string): AffidavitExtraction {
  return {
    age: { status: 'value', years: 47 },
    education: { status: 'value', level: '12th Pass', stated: 'PUC' },
    assets: { status: 'value', movableInr: 500000, immovableInr: 2500000, totalInr: 3000000, note: null },
    cases: { status: 'value', pending: 0, convictions: 0, note: 'States nil' },
    identity: {
      name: { status: 'value', text: name },
      ward: { status: 'not_declared', number: null, name: null, corporation: null },
      party: { status: 'value', text: 'Demo Party A' },
      gender: { status: 'value', gender: 'male' },
    },
    confidence: 71,
  };
}

let adminId: number;
let admin: { cookieValue: string; token: string };
let curator: { cookieValue: string; token: string };
let transcriber: { cookieValue: string; token: string };
const userIds: number[] = [];

/** An affidavit already read by the worker and waiting on this page. */
async function waiting(state: 'needs_matching' | 'failed', name = `Match Me ${randomUUID().slice(0, 6)} (FICTIONAL)`, candidateId: number | null = null) {
  const bytes = Buffer.from(`%PDF-1.4 admin affidavits waiting ${randomUUID()}`);
  const sha256 = randomUUID().replace(/-/g, '').padEnd(64, '0');
  const [m] = await db.insert(schema.media).values({ bytes, contentType: 'application/pdf', sha256, size: bytes.length, createdBy: adminId }).returning({ id: schema.media.id });
  const [a] = await db
    .insert(schema.candidateAffidavits)
    .values(
      state === 'needs_matching'
        ? { mediaId: m.id, sha256, state, matchReason: 'ward_unresolved', extraction: extraction(name), confidence: 71, attempts: 1, candidateId }
        : { mediaId: m.id, sha256, state, failure: 'refusal: model declined the request', attempts: 1, candidateId },
    )
    .returning({ id: schema.candidateAffidavits.id });
  return { id: a.id, mediaId: m.id, name };
}

async function affidavit(id: number) {
  const [row] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.id, id));
  return row;
}

describe('/admin/affidavits', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
    adminId = await upsertUser(EMAILS.admin, 'admin');
    const curatorId = await upsertUser(EMAILS.curator, 'curator');
    const transcriberId = await upsertUser(EMAILS.transcriber, 'transcriber');
    userIds.push(adminId, curatorId, transcriberId);
    admin = await sessionFor(adminId);
    curator = await sessionFor(curatorId);
    transcriber = await sessionFor(transcriberId);
  });

  afterAll(async () => {
    const candidateIds = (await db.select({ id: schema.candidates.id }).from(schema.candidates).where(eq(schema.candidates.wardId, WARD.id))).map((r) => r.id);
    const mediaIds = (await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.createdBy, adminId))).map((r) => r.id);
    if (mediaIds.length) await db.delete(schema.candidateAffidavits).where(inArray(schema.candidateAffidavits.mediaId, mediaIds));
    if (candidateIds.length) {
      await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
      await db.delete(schema.candidates).where(inArray(schema.candidates.id, candidateIds));
    }
    if (mediaIds.length) await db.delete(schema.media).where(inArray(schema.media.id, mediaIds));
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db.delete(schema.wards).where(eq(schema.wards.id, WARD.id));
    await client.end();
  });

  describe('admin only', () => {
    it('redirects an anonymous visitor to login', async () => {
      const res = await run('/admin/affidavits');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/login?next=%2Fadmin%2Faffidavits');
    });

    it.each([['curator', () => curator], ['transcriber', () => transcriber]] as const)('refuses a %s', async (_role, auth) => {
      expect((await run('/admin/affidavits', { cookieValue: auth().cookieValue })).status).toBe(403);
    });

    it('refuses a POST without the CSRF token and stores nothing', async () => {
      const before = await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.createdBy, adminId));
      const fd = new FormData();
      fd.set('formAction', 'upload');
      fd.append('files', pdfFile());
      expect((await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: fd })).status).toBe(403);
      const after = await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.createdBy, adminId));
      expect(after).toHaveLength(before.length);
    });
  });

  describe('upload', () => {
    it('queues each PDF and reports queued, duplicate and rejected counts', async () => {
      const again = pdfFile('again.pdf');
      const first = form(admin.token, { formAction: 'upload' });
      first.append('files', again);
      await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: first });

      const fd = form(admin.token, { formAction: 'upload' });
      fd.append('files', pdfFile('one.pdf'));
      fd.append('files', pdfFile('two.pdf'));
      fd.append('files', again);
      fd.append('files', new File([Buffer.from('not a pdf at all')], 'notes.txt', { type: 'text/plain' }));
      const res = await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: fd });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/admin/affidavits?notice=uploaded&queued=2&duplicate=1&rejected=1');
      expect(res.headers.get('cache-control')).toBe('no-store');

      const page = await (await run('/admin/affidavits?notice=uploaded&queued=2&duplicate=1&rejected=1', { cookieValue: admin.cookieValue })).text();
      expect(page).toContain('2 queued, 1 already stored, 1 not a valid PDF');
    });

    it('asks for a file when none is chosen', async () => {
      const res = await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: form(admin.token, { formAction: 'upload' }) });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Choose at least one PDF');
    });
  });

  describe('needs matching', () => {
    it('lists the AI-read identity beside a link to the PDF', async () => {
      const w = await waiting('needs_matching');
      const html = await (await run('/admin/affidavits', { cookieValue: admin.cookieValue })).text();
      expect(html).toContain(w.name.replace(/[()]/g, (c) => c));
      expect(html).toContain('Demo Party A');
      expect(html).toContain(`/media/${w.mediaId}/`);
      expect(html).toContain(`value="${WARD.id}"`);
    });

    it('creates and publishes the candidate when the admin confirms a ward', async () => {
      const w = await waiting('needs_matching');
      const fd = form(admin.token, { formAction: 'match', affidavitId: String(w.id), wardId: String(WARD.id), name: `${w.name} edited`, party: 'Demo Party B' });
      const res = await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: fd });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/admin/affidavits?notice=matched');

      const row = await affidavit(w.id);
      expect(row).toMatchObject({ state: 'published', matchReason: null });
      const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, row.candidateId!));
      expect(candidate).toMatchObject({ wardId: WARD.id, nameEn: `${w.name} edited`, partyEn: 'Demo Party B' });

      const fields = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidate.id));
      const by = Object.fromEntries(fields.map((f) => [f.fieldKey, f]));
      // The admin confirmed who this is; the affidavit's values are still only AI-read.
      expect(by.full_name.aiExtracted).toBe(false);
      expect(by.party.aiExtracted).toBe(false);
      expect(by.ward.aiExtracted).toBe(false);
      expect(by.age).toMatchObject({ aiExtracted: true, valueEn: '47' });
      expect(by.assets.valueEn).toContain('₹30,00,000');

      const html = await (await run('/admin/affidavits', { cookieValue: admin.cookieValue })).text();
      expect(html).not.toContain(`name="affidavitId" value="${w.id}"`);
    });

    it.each([
      ['an unknown ward', { wardId: '123456789' }],
      ['no ward', { wardId: '' }],
      ['an empty name', { name: '   ' }],
      ['an empty party', { party: '' }],
    ])('refuses %s and leaves the affidavit waiting', async (_what, override) => {
      const w = await waiting('needs_matching');
      const fd = form(admin.token, { formAction: 'match', affidavitId: String(w.id), wardId: String(WARD.id), name: w.name, party: 'Demo Party A', ...override });
      const res = await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: fd });
      expect(res.status).toBe(400);
      expect(await affidavit(w.id)).toMatchObject({ state: 'needs_matching', candidateId: null });
    });

    it('refuses to match an affidavit that is not waiting', async () => {
      const w = await waiting('failed');
      const fd = form(admin.token, { formAction: 'match', affidavitId: String(w.id), wardId: String(WARD.id), name: 'X (FICTIONAL)', party: 'Demo Party A' });
      expect((await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: fd })).status).toBe(400);
      expect((await affidavit(w.id)).state).toBe('failed');
    });

    it('attaches to an existing candidate when the admin says it is the same person', async () => {
      const [existing] = await db
        .insert(schema.candidates)
        .values({ slug: `admin-affidavits-existing-${randomUUID()}`, wardId: WARD.id, nameEn: 'Already Here (FICTIONAL)', partyEn: 'Demo Party A' })
        .returning({ id: schema.candidates.id });
      const w = await waiting('needs_matching');
      const fd = form(admin.token, { formAction: 'match', affidavitId: String(w.id), wardId: String(WARD.id), name: w.name, party: 'Demo Party A', attachToCandidateId: String(existing.id) });
      expect((await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: fd })).status).toBe(302);

      expect(await affidavit(w.id)).toMatchObject({ state: 'published', candidateId: existing.id });
      const [after] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, existing.id));
      expect(after.nameEn).toBe('Already Here (FICTIONAL)');
    });
  });

  describe('failed', () => {
    it('shows the failure and puts a retried affidavit back in the queue', async () => {
      const w = await waiting('failed');
      const html = await (await run('/admin/affidavits', { cookieValue: admin.cookieValue })).text();
      expect(html).toContain('refusal: model declined the request');

      const res = await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: form(admin.token, { formAction: 'retry', affidavitId: String(w.id) }) });
      expect(res.status).toBe(302);
      expect(await affidavit(w.id)).toMatchObject({ state: 'queued', attempts: 0, failure: null });
    });

    it('discards an affidavit and its stored file', async () => {
      const w = await waiting('failed');
      const res = await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: form(admin.token, { formAction: 'discard', affidavitId: String(w.id), confirm: 'on' }) });
      expect(res.status).toBe(302);
      expect(await affidavit(w.id)).toBeUndefined();
      expect(await db.select().from(schema.media).where(eq(schema.media.id, w.mediaId))).toHaveLength(0);
    });

    it('refuses to discard without the confirmation tick', async () => {
      const w = await waiting('failed');
      const res = await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: form(admin.token, { formAction: 'discard', affidavitId: String(w.id) }) });
      expect(res.status).toBe(400);
      expect(await affidavit(w.id)).toBeDefined();
    });

    it('refuses to discard an affidavit a candidate is attached to', async () => {
      const [candidate] = await db
        .insert(schema.candidates)
        .values({ slug: `admin-affidavits-attached-${randomUUID()}`, wardId: WARD.id, nameEn: 'Attached (FICTIONAL)', partyEn: 'Demo Party A' })
        .returning({ id: schema.candidates.id });
      const w = await waiting('failed', undefined, candidate.id);
      const res = await run('/admin/affidavits', { cookieValue: admin.cookieValue, form: form(admin.token, { formAction: 'discard', affidavitId: String(w.id), confirm: 'on' }) });
      expect(res.status).toBe(400);
      expect(await affidavit(w.id)).toBeDefined();
    });
  });
});
