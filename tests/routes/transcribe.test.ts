/**
 * `/transcribe`, `/transcribe/{assignment-id}` and `/transcribe/guide`,
 * through the real middleware and the real page twins. The draw order and
 * the save rules are covered in tests/unit/transcribe.test.ts; this suite
 * is about who may see what, and what each form action does over HTTP.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { db as appDb } from '../../src/db/client';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';
import { fieldsFromExtraction, publishAffidavitFields } from '../../src/lib/affidavit-publish';
import type { AffidavitExtraction } from '../../src/lib/affidavit-extraction';

import StartRoute from '../../src/pages/transcribe/index.astro';
import ReadingRoute from '../../src/pages/transcribe/[id].astro';
import GuideRoute from '../../src/pages/transcribe/guide.astro';
import CandidateRoute from '../../src/pages/candidate/[slug].astro';

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

// This suite owns ward id 99480.
const WARD = { id: 99480, nameEn: 'Transcribe Route Test Ward', nameKn: 'ಪರೀಕ್ಷಾ ವಾರ್ಡ್', corporation: 'south' as const, zone: 'Zone T', boundaryRef: 'transcribe-route-test-ward' };
const EMAIL_PREFIX = 'transcribe-route-test-';

type Auth = { userId: number; cookieValue: string; token: string };
const userIds: number[] = [];
let uploaderId: number;

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

async function run(component: unknown, path: string, opts: { auth?: Auth; form?: FormData; params?: Record<string, string> } = {}): Promise<Response> {
  const url = new URL(path, SITE_URL);
  const headers = new Headers({ 'sec-fetch-site': 'same-origin' });
  const cookieValue = opts.auth?.cookieValue;
  if (cookieValue) headers.set('cookie', `${SESSION_COOKIE}=${cookieValue}`);
  const request = new Request(url, { method: opts.form ? 'POST' : 'GET', headers, body: opts.form });
  const cookiesStub = { get: (name: string) => (name === SESSION_COOKIE && cookieValue ? { value: cookieValue } : undefined) };
  const locals: Record<string, unknown> = {};
  const ctx = { request, url, site: SITE_URL, cookies: cookiesStub, locals } as any;
  const container = await makeContainer();
  const next = async () =>
    container.renderToResponse(component as any, { partial: false, params: opts.params, request, locals: locals as unknown as App.Locals });
  return (await onRequest(ctx, next)) as Response;
}

const start = (auth?: Auth, form?: FormData) => run(StartRoute, '/transcribe', { auth, form });
const reading = (id: number | string, auth?: Auth, form?: FormData) => run(ReadingRoute, `/transcribe/${id}`, { auth, form, params: { id: String(id) } });

async function person(role: 'transcriber' | 'admin' | 'curator' | 'citizen'): Promise<Auth> {
  const [row] = await db
    .insert(schema.users)
    .values({ email: `${EMAIL_PREFIX}${randomUUID()}@example.com`, role })
    .returning({ id: schema.users.id });
  userIds.push(row.id);
  const { id, cookieValue } = await createSession(row.id);
  return { userId: row.id, cookieValue, token: issueCsrfToken(id) };
}

function extraction(): AffidavitExtraction {
  return {
    age: { status: 'value', years: 52 },
    education: { status: 'value', level: 'Graduate', stated: 'B.Com' },
    assets: { status: 'value', movableInr: 10210000, immovableInr: 35000000, totalInr: 45210000, note: 'Self 2 crore; spouse 2.5 crore' },
    cases: { status: 'value', pending: 2, convictions: 0, note: 'IPC 420 and 468' },
    identity: {
      name: { status: 'value', text: `Route Person ${randomUUID().slice(0, 8)} (FICTIONAL)` },
      ward: { status: 'value', number: 480, name: WARD.nameEn, corporation: 'south' },
      party: { status: 'value', text: 'Demo Party A' },
      gender: { status: 'value', gender: 'female' },
    },
    confidence: 64,
  };
}

async function published() {
  const e = extraction();
  const bytes = Buffer.from(`%PDF-1.4 transcribe route test ${randomUUID()}`);
  const sha256 = randomUUID().replace(/-/g, '').padEnd(64, '0');
  const [m] = await db.insert(schema.media).values({ bytes, contentType: 'application/pdf', sha256, size: bytes.length, createdBy: uploaderId }).returning({ id: schema.media.id });
  const slug = `transcribe-route-test-${randomUUID()}`;
  const [c] = await db.insert(schema.candidates).values({ slug, wardId: WARD.id, nameEn: e.identity.name.text!, partyEn: 'Demo Party A' }).returning({ id: schema.candidates.id });
  const pdfUrl = `/media/${m.id}/${sha256.slice(0, 16)}`;
  await appDb.transaction((tx) => publishAffidavitFields(tx, { userId: null, role: 'system' }, c.id, fieldsFromExtraction(e), { sourceUrl: pdfUrl, checked: false }));
  const [a] = await db
    .insert(schema.candidateAffidavits)
    .values({ candidateId: c.id, mediaId: m.id, sha256, state: 'published', extraction: e, confidence: e.confidence, attempts: 1 })
    .returning({ id: schema.candidateAffidavits.id });
  return { affidavitId: a.id, candidateId: c.id, slug, pdfUrl, extraction: e };
}

function tokenForm(auth: Auth, fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set(CSRF_FIELD_NAME, auth.token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Presses Start and returns the assignment id the redirect names. */
async function draw(auth: Auth): Promise<number> {
  const res = await start(auth, tokenForm(auth, { formAction: 'start' }));
  expect(res.status).toBe(302);
  const match = /^\/transcribe\/(\d+)$/.exec(res.headers.get('location') ?? '');
  expect(match).not.toBeNull();
  return Number(match![1]);
}

/** The reading form as the screen pre-fills it, with overrides and ticks. */
function readingForm(auth: Auth, e: AffidavitExtraction, overrides: Record<string, string>, checked: string[]): FormData {
  const fd = tokenForm(auth, {
    formAction: 'save',
    name: e.identity.name.text!,
    party: e.identity.party.text!,
    gender: e.identity.gender.gender!,
    age: String(e.age.years),
    educationLevel: e.education.level!,
    educationStated: e.education.stated!,
    movableInr: String(e.assets.movableInr),
    immovableInr: String(e.assets.immovableInr),
    pending: String(e.cases.pending),
    convictions: String(e.cases.convictions),
    'status.full_name': 'value',
    'status.party': 'value',
    'status.gender': 'value',
    'status.age': 'value',
    'status.education': 'value',
    'status.assets': 'value',
    'status.cases': 'value',
    ...overrides,
  });
  for (const key of checked) fd.set(`checked.${key}`, 'on');
  return fd;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
  uploaderId = (await person('admin')).userId;
});

beforeEach(async () => {
  await db.execute(sql`UPDATE transcription_assignments SET state = 'abandoned', closed_at = now() WHERE state = 'open'`);
  await db.execute(sql`UPDATE candidate_affidavits SET transcribed_at = now() WHERE transcribed_at IS NULL`);
});

afterAll(async () => {
  const candidateIds = (await db.select({ id: schema.candidates.id }).from(schema.candidates).where(eq(schema.candidates.wardId, WARD.id))).map((r) => r.id);
  const mediaIds = (await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.createdBy, uploaderId))).map((r) => r.id);
  if (mediaIds.length) await db.delete(schema.candidateAffidavits).where(inArray(schema.candidateAffidavits.mediaId, mediaIds));
  if (candidateIds.length) {
    await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
    await db.delete(schema.candidates).where(inArray(schema.candidates.id, candidateIds));
  }
  if (mediaIds.length) await db.delete(schema.media).where(inArray(schema.media.id, mediaIds));
  await db.delete(schema.transcriptionAssignments).where(inArray(schema.transcriptionAssignments.transcriberId, userIds));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
  await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  await db.delete(schema.wards).where(eq(schema.wards.id, WARD.id));
  await client.end();
});

describe('who may enter', () => {
  it('sends an anonymous visitor to login and back', async () => {
    const res = await start();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login?next=%2Ftranscribe');
  });

  it.each(['citizen', 'curator'] as const)('refuses a %s', async (role) => {
    expect((await start(await person(role))).status).toBe(403);
  });

  it.each(['transcriber', 'admin'] as const)('admits a %s, uncached and unindexed', async (role) => {
    const res = await start(await person(role));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('refuses a POST without the CSRF token and draws nothing', async () => {
    await published();
    const me = await person('transcriber');
    const fd = new FormData();
    fd.set('formAction', 'start');
    expect((await start(me, fd)).status).toBe(403);
    const mine = await db.select().from(schema.transcriptionAssignments).where(eq(schema.transcriptionAssignments.transcriberId, me.userId));
    expect(mine).toHaveLength(0);
  });
});

describe('/transcribe', () => {
  it('offers one Start control and no way to choose', async () => {
    await published();
    const html = await (await start(await person('transcriber'))).text();
    expect(html).toContain('name="formAction" value="start"');
    expect(html).toContain('1 affidavit');
    expect(html).not.toMatch(/<select|type="search"|name="q"|name="ward"/);
    expect(html).not.toContain('Route Person');
    expect(html).toContain('href="/transcribe/guide"');
  });

  it('says so when nothing is waiting, and Start then finds nothing', async () => {
    const me = await person('transcriber');
    expect(await (await start(me)).text()).toContain('Nothing is waiting');
    const res = await start(me, tokenForm(me, { formAction: 'start' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/transcribe?empty=1');
  });

  it('offers Resume to someone already holding an affidavit', async () => {
    await published();
    const me = await person('transcriber');
    const id = await draw(me);
    const html = await (await start(me)).text();
    expect(html).toContain(`href="/transcribe/${id}"`);
    expect(html).not.toContain('name="formAction" value="start"');
    expect(await draw(me)).toBe(id);
  });
});

describe('/transcribe/{assignment-id}', () => {
  it('shows the affidavit beside a form pre-filled with the AI values', async () => {
    const a = await published();
    const me = await person('transcriber');
    const res = await reading(await draw(me), me);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("frame-src 'self'");
    const html = await res.text();
    expect(html).toContain(`<iframe`);
    expect(html).toContain(`src="${a.pdfUrl}`);
    expect(html).toContain(WARD.nameEn);
    expect(html).toContain('64%');
    expect(html).toMatch(/name="age"[^>]*value="52"/);
    expect(html).toMatch(/name="movableInr"[^>]*value="10210000"/);
    expect(html).toContain('IPC 420 and 468');
    expect(html).toContain('name="checked.assets"');
    expect(html).not.toMatch(/name="checked\.[a-z_]+"[^>]*checked/);
    expect(html).not.toMatch(/name="wardId"/);
  });

  it.each(['abc', '0', '-4', '99999999999', '1.5'])('answers 404 for the id %s', async (id) => {
    expect((await reading(id, await person('transcriber'))).status).toBe(404);
  });

  it("answers 404 for someone else's assignment, for an admin too", async () => {
    await published();
    const id = await draw(await person('transcriber'));
    expect((await reading(id, await person('transcriber'))).status).toBe(404);
    expect((await reading(id, await person('admin'))).status).toBe(404);
  });

  it('saves the ticked fields, and the public page then says a person checked them', async () => {
    const a = await published();
    const me = await person('transcriber');
    const id = await draw(me);

    const res = await reading(id, me, readingForm(me, a.extraction, { age: '53' }, ['age', 'cases']));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/transcribe?saved=1');

    const [age] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, a.candidateId), eq(schema.candidateFields.fieldKey, 'age')));
    expect(age).toMatchObject({ valueEn: '53', aiExtracted: false, checkedBy: me.userId, confirmedAi: false });

    const page = await (await run(CandidateRoute, `/candidate/${a.slug}`, { params: { slug: a.slug } })).text();
    expect(page).toMatch(/>\s*53\s*</);
    expect(page).not.toMatch(/>\s*52\s*</);
    const after = await (await run(StartRoute, '/transcribe?saved=1', { auth: me })).text();
    expect(after).toContain('Saved. Your checked values are live');
    expect(after).toContain('Next affidavit');
    expect((await reading(id, me)).status).toBe(404);
  });

  it('refuses an invalid value with a 400 and keeps everything that was typed', async () => {
    const a = await published();
    const me = await person('transcriber');
    const id = await draw(me);
    const res = await reading(id, me, readingForm(me, a.extraction, { age: 'fifty', movableInr: '1,00,000' }, ['age', 'assets']));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toMatch(/name="age"[^>]*value="fifty"/);
    expect(html).toMatch(/name="movableInr"[^>]*value="1,00,000"/);
    expect(html).toMatch(/name="checked\.age"[^>]*checked/);
    expect(html).toContain('whole number');
    const [age] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, a.candidateId), eq(schema.candidateFields.fieldKey, 'age')));
    expect(age).toMatchObject({ valueEn: '52', aiExtracted: true });
  });

  it('asks for at least one tick', async () => {
    const a = await published();
    const me = await person('transcriber');
    const res = await reading(await draw(me), me, readingForm(me, a.extraction, {}, []));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Tick at least one field');
  });

  it('sends a save that arrives after the hold expired back to the start, having written nothing', async () => {
    const a = await published();
    const me = await person('transcriber');
    const id = await draw(me);
    await db.execute(sql`UPDATE transcription_assignments SET expires_at = now() - interval '1 minute' WHERE id = ${id}`);
    const res = await reading(id, me, readingForm(me, a.extraction, { age: '53' }, ['age']));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/transcribe?expired=1');
  });

  it('releases the affidavit back to the queue', async () => {
    await published();
    const me = await person('transcriber');
    const id = await draw(me);
    const res = await reading(id, me, tokenForm(me, { formAction: 'release' }));
    expect(res.headers.get('location')).toBe('/transcribe?released=1');
    const [row] = await db.select().from(schema.transcriptionAssignments).where(eq(schema.transcriptionAssignments.id, id));
    expect(row.state).toBe('abandoned');
  });

  it('reports a wrong document with a note, and insists on the note', async () => {
    const a = await published();
    const me = await person('transcriber');
    const id = await draw(me);

    const missing = await reading(id, me, tokenForm(me, { formAction: 'report', note: '  ' }));
    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain('Say what is wrong');

    const res = await reading(id, me, tokenForm(me, { formAction: 'report', note: 'Belongs to another ward.' }));
    expect(res.headers.get('location')).toBe('/transcribe?reported=1');
    const [aff] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.id, a.affidavitId));
    expect(aff).toMatchObject({ state: 'needs_matching', matchReason: 'reported_by_transcriber', matchNote: 'Belongs to another ward.' });
  });

  it('answers 400 to a form action it does not know', async () => {
    await published();
    const me = await person('transcriber');
    expect((await reading(await draw(me), me, tokenForm(me, { formAction: 'publish-everything' }))).status).toBe(400);
  });
});

describe('/transcribe/guide', () => {
  it('tells a transcriber never to guess, in their saved language', async () => {
    const me = await person('transcriber');
    const html = await (await run(GuideRoute, '/transcribe/guide', { auth: me })).text();
    expect(html).toContain('Never guess');
    await db.update(schema.users).set({ language: 'kn' }).where(eq(schema.users.id, me.userId));
    const kn = await (await run(GuideRoute, '/transcribe/guide', { auth: me })).text();
    expect(kn).toContain('lang="kn"');
    expect(kn).not.toContain('Never guess');
  });
});
