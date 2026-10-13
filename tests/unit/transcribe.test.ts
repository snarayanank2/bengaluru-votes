/**
 * src/lib/transcribe.ts: the draw (who gets which affidavit, in what
 * order, and never the same one twice), and what a save, a release and a
 * wrong-document report do.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { db as appDb } from '../../src/db/client';
import { fieldsFromExtraction, publishAffidavitFields } from '../../src/lib/affidavit-publish';
import type { AffidavitExtraction } from '../../src/lib/affidavit-extraction';
import {
  ASSIGNMENT_MINUTES,
  countSubmittedToday,
  drawAssignment,
  loadAssignment,
  releaseAssignment,
  reportWrongDocument,
  submitAssignment,
} from '../../src/lib/transcribe';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// This suite owns ward id 99470.
const WARD = { id: 99470, nameEn: 'Transcribe Test Ward', nameKn: 'ಪರೀಕ್ಷಾ ವಾರ್ಡ್', corporation: 'south' as const, zone: 'Zone T', boundaryRef: 'transcribe-test-ward' };
const EMAIL_PREFIX = 'transcribe-unit-test-';
const users: number[] = [];
let uploaderId: number;

function extraction(opts: { confidence?: number; casesUnreadable?: boolean } = {}): AffidavitExtraction {
  return {
    age: { status: 'value', years: 52 },
    education: { status: 'value', level: 'Graduate', stated: 'B.Com' },
    assets: { status: 'value', movableInr: 10210000, immovableInr: 35000000, totalInr: 45210000, note: 'Self and spouse' },
    cases: opts.casesUnreadable
      ? { status: 'unreadable', pending: null, convictions: null, note: 'Page too faint' }
      : { status: 'value', pending: 2, convictions: 0, note: 'IPC 420' },
    identity: {
      name: { status: 'value', text: `Transcribe Person ${randomUUID().slice(0, 8)} (FICTIONAL)` },
      ward: { status: 'value', number: 470, name: WARD.nameEn, corporation: 'south' },
      party: { status: 'value', text: 'Demo Party A' },
      gender: { status: 'value', gender: 'female' },
    },
    confidence: opts.confidence ?? 90,
  };
}

/** A published, AI-labelled affidavit ready to be drawn. */
async function published(opts: { confidence?: number; casesUnreadable?: boolean; state?: 'published' | 'needs_matching' | 'failed' } = {}) {
  const e = extraction(opts);
  const bytes = Buffer.from(`%PDF-1.4 transcribe test ${randomUUID()}`);
  const sha256 = randomUUID().replace(/-/g, '').padEnd(64, '0');
  const [m] = await db.insert(schema.media).values({ bytes, contentType: 'application/pdf', sha256, size: bytes.length, createdBy: uploaderId }).returning({ id: schema.media.id });
  const [c] = await db
    .insert(schema.candidates)
    .values({ slug: `transcribe-test-${randomUUID()}`, wardId: WARD.id, nameEn: e.identity.name.text!, partyEn: 'Demo Party A' })
    .returning({ id: schema.candidates.id });
  await appDb.transaction((tx) =>
    publishAffidavitFields(tx, { userId: null, role: 'system' }, c.id, fieldsFromExtraction(e), { sourceUrl: `/media/${m.id}/${sha256.slice(0, 16)}`, checked: false }),
  );
  const [a] = await db
    .insert(schema.candidateAffidavits)
    .values({ candidateId: c.id, mediaId: m.id, sha256, state: opts.state ?? 'published', extraction: e, confidence: e.confidence, attempts: 1 })
    .returning({ id: schema.candidateAffidavits.id });
  return { affidavitId: a.id, candidateId: c.id, extraction: e };
}

async function user(): Promise<number> {
  const [row] = await db
    .insert(schema.users)
    .values({ email: `${EMAIL_PREFIX}${randomUUID()}@example.com`, role: 'transcriber' })
    .returning({ id: schema.users.id });
  users.push(row.id);
  return row.id;
}

async function assignment(id: number) {
  const [row] = await db.select().from(schema.transcriptionAssignments).where(eq(schema.transcriptionAssignments.id, id));
  return row;
}

async function affidavitOf(assignmentId: number): Promise<number> {
  return (await assignment(assignmentId)).affidavitId;
}

async function field(candidateId: number, key: string) {
  const [row] = await db
    .select()
    .from(schema.candidateFields)
    .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, key)));
  return row;
}

/** The form a transcriber posts: every input pre-filled as the screen shows it, then the overrides. */
function form(e: AffidavitExtraction, overrides: Record<string, string>, checked: string[]): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    name: e.identity.name.text ?? '',
    party: e.identity.party.text ?? '',
    gender: e.identity.gender.gender ?? '',
    age: String(e.age.years ?? ''),
    educationLevel: e.education.level ?? '',
    educationStated: e.education.stated ?? '',
    movableInr: String(e.assets.movableInr ?? ''),
    immovableInr: String(e.assets.immovableInr ?? ''),
    pending: String(e.cases.pending ?? ''),
    convictions: String(e.cases.convictions ?? ''),
    'status.full_name': 'value',
    'status.party': 'value',
    'status.gender': 'value',
    'status.age': 'value',
    'status.education': 'value',
    'status.assets': 'value',
    'status.cases': e.cases.status,
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) fd.set(k, v);
  for (const key of checked) fd.set(`checked.${key}`, 'on');
  return fd;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
  const [u] = await db.insert(schema.users).values({ email: `${EMAIL_PREFIX}uploader-${randomUUID()}@example.com`, role: 'admin' }).returning({ id: schema.users.id });
  uploaderId = u.id;
  users.push(u.id);
});

beforeEach(async () => {
  // Take everything already in the database out of the draw, so each test
  // sees only the affidavits it creates.
  await db.execute(sql`UPDATE transcription_assignments SET state = 'abandoned', closed_at = now() WHERE state = 'open'`);
  await db.execute(sql`UPDATE candidate_affidavits SET transcribed_at = now() WHERE transcribed_at IS NULL`);
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'low_confidence_threshold'));
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
  await db.delete(schema.transcriptionAssignments).where(inArray(schema.transcriptionAssignments.transcriberId, users));
  await db.delete(schema.users).where(inArray(schema.users.id, users));
  await db.delete(schema.wards).where(eq(schema.wards.id, WARD.id));
  await client.end();
});

describe('drawAssignment', () => {
  it('returns null when nothing is waiting', async () => {
    expect(await drawAssignment(await user())).toBeNull();
  });

  it('hands out missing data first, then low confidence, then the rest', async () => {
    const clean = await published({ confidence: 95 });
    const low = await published({ confidence: 40 });
    const missing = await published({ confidence: 95, casesUnreadable: true });

    const order: number[] = [];
    for (let i = 0; i < 3; i += 1) order.push(await affidavitOf((await drawAssignment(await user()))!));
    expect(order).toEqual([missing.affidavitId, low.affidavitId, clean.affidavitId]);
    expect(await drawAssignment(await user())).toBeNull();
  });

  it('reads the low-confidence line from app_settings', async () => {
    const eighty = await published({ confidence: 80 });
    const ninety = await published({ confidence: 90 });
    await db.insert(schema.appSettings).values({ key: 'low_confidence_threshold', value: '85' });
    expect(await affidavitOf((await drawAssignment(await user()))!)).toBe(eighty.affidavitId);
    expect(await affidavitOf((await drawAssignment(await user()))!)).toBe(ninety.affidavitId);
  });

  it('sets a 45-minute hold', async () => {
    await published();
    const row = await assignment((await drawAssignment(await user()))!);
    expect(row.state).toBe('open');
    const minutes = (row.expiresAt.getTime() - row.drawnAt.getTime()) / 60000;
    expect(ASSIGNMENT_MINUTES).toBe(45);
    expect(Math.round(minutes)).toBe(45);
  });

  it('never gives two people the same affidavit, even when they ask together', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 20; i += 1) ids.push((await published()).affidavitId);
    const people = await Promise.all(Array.from({ length: 20 }, () => user()));

    const drawn = await Promise.all(people.map((p) => drawAssignment(p)));
    expect(drawn.every((d) => d !== null)).toBe(true);
    const affidavits = await Promise.all(drawn.map((d) => affidavitOf(d!)));
    expect(new Set(affidavits).size).toBe(20);
    expect([...affidavits].sort()).toEqual([...ids].sort());
  });

  it('gives one person one assignment, however many times and however fast they ask', async () => {
    await published();
    await published();
    const me = await user();
    const drawn = await Promise.all(Array.from({ length: 5 }, () => drawAssignment(me)));
    expect(new Set(drawn).size).toBe(1);
    expect(await drawAssignment(me)).toBe(drawn[0]);
  });

  it('returns an expired hold to the queue, including to the person who held it', async () => {
    const only = await published();
    const first = await user();
    const held = (await drawAssignment(first))!;
    expect(await drawAssignment(await user())).toBeNull();

    await db.execute(sql`UPDATE transcription_assignments SET expires_at = now() - interval '1 minute' WHERE id = ${held}`);

    const again = (await drawAssignment(first))!;
    expect(again).not.toBe(held);
    expect(await affidavitOf(again)).toBe(only.affidavitId);
    expect((await assignment(held)).state).toBe('abandoned');
  });

  it.each(['needs_matching', 'failed'] as const)('never hands out an affidavit that is %s', async (state) => {
    await published({ state });
    expect(await drawAssignment(await user())).toBeNull();
  });

  it('never hands out an affidavit that has been transcribed', async () => {
    const a = await published();
    await db.execute(sql`UPDATE candidate_affidavits SET transcribed_at = now() WHERE id = ${a.affidavitId}`);
    expect(await drawAssignment(await user())).toBeNull();
  });
});

describe('loadAssignment', () => {
  it('shows the holder the affidavit, its ward and the AI values, pre-filled', async () => {
    const a = await published({ confidence: 64 });
    const me = await user();
    const view = (await loadAssignment(me, (await drawAssignment(me))!))!;
    expect(view.confidence).toBe(64);
    expect(view.ward).toMatchObject({ id: WARD.id, nameEn: WARD.nameEn });
    expect(view.pdfUrl).toMatch(/^\/media\/\d+\/[0-9a-f]{16}$/);
    expect(view.fields.map((f) => f.key)).toEqual(['full_name', 'party', 'gender', 'age', 'education', 'assets', 'cases']);
    const assets = view.fields.find((f) => f.key === 'assets')!;
    expect(assets).toMatchObject({ status: 'value', aiExtracted: true, checked: false, note: 'Self and spouse' });
    expect(assets.inputs).toEqual({ movableInr: '10210000', immovableInr: '35000000' });
    expect(view.fields.find((f) => f.key === 'full_name')!.inputs.name).toBe(a.extraction.identity.name.text);
  });

  it('shows nothing to anyone else, and nothing once it has expired', async () => {
    await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    expect(await loadAssignment(await user(), id)).toBeNull();
    expect(await loadAssignment(me, 2147483000)).toBeNull();
    await db.execute(sql`UPDATE transcription_assignments SET expires_at = now() - interval '1 minute' WHERE id = ${id}`);
    expect(await loadAssignment(me, id)).toBeNull();
  });
});

describe('submitAssignment', () => {
  it('publishes the ticked fields as checked and leaves the rest AI-labelled', async () => {
    const a = await published();
    const me = await user();
    const id = (await drawAssignment(me))!;

    const outcome = await submitAssignment(me, id, form(a.extraction, { age: '53', movableInr: '1,02,10,000' }, ['age', 'assets']));
    expect(outcome).toMatchObject({ kind: 'saved', candidateId: a.candidateId });

    expect(await field(a.candidateId, 'age')).toMatchObject({ valueEn: '53', aiExtracted: false, checkedBy: me, confirmedAi: false });
    expect(await field(a.candidateId, 'assets')).toMatchObject({ aiExtracted: false, checkedBy: me, confirmedAi: true });
    expect((await field(a.candidateId, 'assets')).valueEn).toContain('₹4,52,10,000');
    expect(await field(a.candidateId, 'education')).toMatchObject({ aiExtracted: true, checkedBy: null });

    expect((await assignment(id)).state).toBe('submitted');
    expect((await assignment(id)).closedAt).not.toBeNull();
    const [aff] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.id, a.affidavitId));
    expect(aff.transcribedAt).not.toBeNull();
    expect(await countSubmittedToday(me)).toBe(1);
    expect(await drawAssignment(me)).toBeNull();
  });

  it('renames the candidate when the name is corrected', async () => {
    const a = await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    await submitAssignment(me, id, form(a.extraction, { name: 'Corrected Name (FICTIONAL)' }, ['full_name']));
    const [c] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, a.candidateId));
    expect(c.nameEn).toBe('Corrected Name (FICTIONAL)');
    expect(await field(a.candidateId, 'full_name')).toMatchObject({ aiExtracted: false, confirmedAi: false });
  });

  it('publishes "not declared" as a checked answer and "cannot read" as unresolved', async () => {
    const a = await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    await submitAssignment(me, id, form(a.extraction, { 'status.age': 'not_declared', 'status.assets': 'unreadable' }, ['age', 'assets']));
    expect(await field(a.candidateId, 'age')).toMatchObject({ valueEn: null, notDeclared: true, aiExtracted: false, checkedBy: me });
    expect(await field(a.candidateId, 'assets')).toMatchObject({ valueEn: null, unreadable: true, aiExtracted: true, checkedBy: null });
  });

  it('asks for at least one ticked field', async () => {
    const a = await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    const outcome = await submitAssignment(me, id, form(a.extraction, {}, []));
    expect(outcome).toMatchObject({ kind: 'invalid', formError: 'nothing_checked' });
    expect((await assignment(id)).state).toBe('open');
  });

  it.each([
    ['letters for an age', { age: 'abc' }, 'age'],
    ['an age of 0', { age: '0' }, 'age'],
    ['a negative amount', { movableInr: '-5' }, 'assets'],
    ['a decimal amount', { immovableInr: '12.5' }, 'assets'],
    ['an empty count', { pending: '' }, 'cases'],
    ['an empty name', { name: '  ' }, 'full_name'],
    ['an unknown education level', { educationLevel: 'PhD-ish' }, 'education'],
    ['an unknown gender', { gender: 'x' }, 'gender'],
  ])('rejects %s, writes nothing and keeps what was typed', async (_what, overrides, key) => {
    const a = await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    const outcome = await submitAssignment(me, id, form(a.extraction, overrides, ['age', 'assets', 'cases', 'full_name', 'education', 'gender']));
    expect(outcome.kind).toBe('invalid');
    if (outcome.kind !== 'invalid') return;
    expect(Object.keys(outcome.errors)).toEqual([key]);
    const [name, value] = Object.entries(overrides)[0];
    expect(outcome.raw.inputs[name]).toBe(value);
    expect(outcome.raw.checked).toContain('age');
    expect(await field(a.candidateId, 'age')).toMatchObject({ aiExtracted: true, checkedBy: null });
    expect((await assignment(id)).state).toBe('open');
  });

  it('ignores a bad value in a field that was not ticked', async () => {
    const a = await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    const outcome = await submitAssignment(me, id, form(a.extraction, { age: 'abc' }, ['cases']));
    expect(outcome.kind).toBe('saved');
    expect(await field(a.candidateId, 'age')).toMatchObject({ valueEn: '52', aiExtracted: true });
  });

  it('writes nothing once the hold has expired', async () => {
    const a = await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    await db.execute(sql`UPDATE transcription_assignments SET expires_at = now() - interval '1 minute' WHERE id = ${id}`);
    expect(await submitAssignment(me, id, form(a.extraction, { age: '53' }, ['age']))).toEqual({ kind: 'expired' });
    expect(await field(a.candidateId, 'age')).toMatchObject({ valueEn: '52', aiExtracted: true });
  });

  it("writes nothing through someone else's assignment, or the same one twice", async () => {
    const a = await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    expect(await submitAssignment(await user(), id, form(a.extraction, { age: '53' }, ['age']))).toEqual({ kind: 'expired' });
    expect(await field(a.candidateId, 'age')).toMatchObject({ valueEn: '52' });

    expect((await submitAssignment(me, id, form(a.extraction, { age: '53' }, ['age']))).kind).toBe('saved');
    expect(await submitAssignment(me, id, form(a.extraction, { age: '60' }, ['age']))).toEqual({ kind: 'expired' });
    expect(await field(a.candidateId, 'age')).toMatchObject({ valueEn: '53' });
  });
});

describe('releaseAssignment and reportWrongDocument', () => {
  it('returns a released affidavit to the queue', async () => {
    const a = await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    expect(await releaseAssignment(me, id)).toBe(true);
    expect((await assignment(id)).state).toBe('abandoned');
    expect(await affidavitOf((await drawAssignment(await user()))!)).toBe(a.affidavitId);
  });

  it("does not release someone else's hold", async () => {
    await published();
    const id = (await drawAssignment(await user()))!;
    expect(await releaseAssignment(await user(), id)).toBe(false);
    expect((await assignment(id)).state).toBe('open');
  });

  it('needs a note to report a wrong document', async () => {
    await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    expect(await reportWrongDocument(me, id, '   ')).toBe('note_required');
    expect((await assignment(id)).state).toBe('open');
  });

  it('sends a reported affidavit to the admin list with the note, out of the queue', async () => {
    const a = await published();
    const me = await user();
    const id = (await drawAssignment(me))!;
    expect(await reportWrongDocument(me, id, 'This is for ward 12, not this ward.')).toBe('reported');

    const [aff] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.id, a.affidavitId));
    expect(aff).toMatchObject({ state: 'needs_matching', matchReason: 'reported_by_transcriber', matchNote: 'This is for ward 12, not this ward.', candidateId: a.candidateId });
    expect((await assignment(id)).state).toBe('abandoned');
    expect(await drawAssignment(await user())).toBeNull();
    expect(await reportWrongDocument(await user(), id, 'again')).toBe('not_found');
  });
});
