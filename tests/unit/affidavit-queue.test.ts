/**
 * src/lib/affidavit-queue.ts: enqueueing, the worker's claim, ward
 * resolution, and what happens to an affidavit after extraction succeeds
 * or fails. No model is called: `processOne` takes the extractor.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import {
  MAX_ATTEMPTS,
  enqueueAffidavit,
  claimNextAffidavit,
  resolveWard,
  processOne,
} from '../../src/lib/affidavit-queue';
import type { AffidavitExtraction, ExtractionOutcome } from '../../src/lib/affidavit-extraction';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// Ward ids follow the real scheme (corporation index * 1000 + ward number)
// with numbers no real ward uses: South is 4, West is 5.
const WARD_SOUTH = { id: 4990, nameEn: 'Queue Test Ward Alpha', nameKn: 'ಪರೀಕ್ಷೆ ಎ', corporation: 'south' as const, zone: 'Zone T', boundaryRef: 'queue-test-ward-alpha' };
// Named as the real wards are: the number, a dash, then the name.
const WARD_WEST = { id: 5991, nameEn: '991 - Queue Test Ward Beta', nameKn: 'ಪರೀಕ್ಷೆ ಬಿ', corporation: 'west' as const, zone: 'Zone T', boundaryRef: 'queue-test-ward-beta' };
const WARD_IDS = [WARD_SOUTH.id, WARD_WEST.id];
const UPLOADER_EMAIL = 'affidavit-queue-test-admin@example.com';

let uploaderId: number;

function pdf(): Buffer {
  return Buffer.from(`%PDF-1.4 queue test ${randomUUID()}`);
}

function extraction(overrides: Partial<AffidavitExtraction['identity']> = {}): AffidavitExtraction {
  return {
    age: { status: 'value', years: 52 },
    education: { status: 'value', level: 'Graduate', stated: 'B.Com' },
    assets: { status: 'value', movableInr: 100, immovableInr: 900, totalInr: 1000, note: null },
    cases: { status: 'unreadable', pending: null, convictions: null, note: 'page too faint' },
    identity: {
      name: { status: 'value', text: `Queue Person ${randomUUID().slice(0, 8)} (FICTIONAL)` },
      ward: { status: 'value', number: 990, name: 'Queue Test Ward Alpha', corporation: 'south' },
      party: { status: 'value', text: 'Demo Party A' },
      gender: { status: 'value', gender: 'male' },
      ...overrides,
    },
    confidence: 64,
  };
}

function ok(e: AffidavitExtraction): () => Promise<ExtractionOutcome> {
  return async () => ({ ok: true, extraction: e, usage: { model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 1, elapsedMs: 1, stopReason: 'end_turn' } });
}

function failing(failure: 'api_error' | 'refusal' | 'truncated' | 'invalid_output'): () => Promise<ExtractionOutcome> {
  return async () => ({ ok: false, failure, detail: `test ${failure}` });
}

async function affidavit(id: number) {
  const [row] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.id, id));
  return row;
}

async function queued(opts: { candidateId?: number } = {}): Promise<number> {
  const result = await enqueueAffidavit(pdf(), { uploadedBy: uploaderId, candidateId: opts.candidateId });
  if (result.kind !== 'queued') throw new Error(`expected queued, got ${result.kind}`);
  return result.id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  for (const ward of [WARD_SOUTH, WARD_WEST]) {
    await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
  }
  const [user] = await db
    .insert(schema.users)
    .values({ email: UPLOADER_EMAIL, role: 'admin' })
    .onConflictDoUpdate({ target: schema.users.email, set: { role: 'admin' } })
    .returning({ id: schema.users.id });
  uploaderId = user.id;
});

beforeEach(async () => {
  // Rows other suites left waiting would be claimed by these tests' workers.
  await db.execute(sql`UPDATE candidate_affidavits SET state = 'failed', lease_expires_at = NULL WHERE state IN ('queued', 'extracting')`);
});

afterAll(async () => {
  const candidateIds = (await db.select({ id: schema.candidates.id }).from(schema.candidates).where(inArray(schema.candidates.wardId, WARD_IDS))).map((r) => r.id);
  const mine = await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.createdBy, uploaderId));
  const mediaIds = mine.map((r) => r.id);
  if (mediaIds.length) await db.delete(schema.candidateAffidavits).where(inArray(schema.candidateAffidavits.mediaId, mediaIds));
  if (candidateIds.length) {
    await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
    await db.delete(schema.candidates).where(inArray(schema.candidates.id, candidateIds));
  }
  if (mediaIds.length) await db.delete(schema.media).where(inArray(schema.media.id, mediaIds));
  await db.delete(schema.users).where(eq(schema.users.id, uploaderId));
  await db.delete(schema.wards).where(inArray(schema.wards.id, WARD_IDS));
  await client.end();
});

describe('enqueueAffidavit', () => {
  it('stores a PDF as a queued affidavit with its hash', async () => {
    const result = await enqueueAffidavit(pdf(), { uploadedBy: uploaderId, originUrl: 'https://affidavit.eci.gov.in/x' });
    expect(result.kind).toBe('queued');
    if (result.kind !== 'queued') return;
    const row = await affidavit(result.id);
    expect(row).toMatchObject({ state: 'queued', attempts: 0, candidateId: null, originUrl: 'https://affidavit.eci.gov.in/x' });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports the same bytes again as a duplicate of the first', async () => {
    const bytes = pdf();
    const first = await enqueueAffidavit(bytes, { uploadedBy: uploaderId });
    const second = await enqueueAffidavit(bytes, { uploadedBy: uploaderId });
    expect(first.kind).toBe('queued');
    expect(second).toEqual({ kind: 'duplicate', id: (first as { id: number }).id });
  });

  it('keeps one affidavit and one stored file when the same bytes arrive twice at once', async () => {
    const bytes = pdf();
    const results = await Promise.all([1, 2, 3, 4].map(() => enqueueAffidavit(bytes, { uploadedBy: uploaderId })));
    expect(results.filter((r) => r.kind === 'queued')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'duplicate')).toHaveLength(3);
    const sha = (await affidavit((results[0] as { id: number }).id)).sha256!;
    const stored = await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.sha256, sha));
    expect(stored).toHaveLength(1);
  });

  it('rejects a file that is not a PDF', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(await enqueueAffidavit(png, { uploadedBy: uploaderId })).toEqual({ kind: 'rejected', reason: 'unsupported_media_type' });
  });

  it('rejects a PDF over 20 MB', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4 '), Buffer.alloc(20 * 1024 * 1024 + 1)]);
    expect(await enqueueAffidavit(big, { uploadedBy: uploaderId })).toEqual({ kind: 'rejected', reason: 'media_too_large' });
  });
});

describe('claimNextAffidavit', () => {
  it('gives ten simultaneous workers ten different affidavits, and an eleventh nothing', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 10; i += 1) ids.push(await queued());

    const claims = await Promise.all(Array.from({ length: 10 }, () => claimNextAffidavit()));
    expect(claims.every((c) => c !== null)).toBe(true);
    expect(new Set(claims.map((c) => c!.id)).size).toBe(10);
    expect(claims.map((c) => c!.id).sort()).toEqual([...ids].sort());
    expect(await claimNextAffidavit()).toBeNull();

    const row = await affidavit(ids[0]);
    expect(row).toMatchObject({ state: 'extracting', attempts: 1 });
    expect(row.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('hands out an affidavit again once its lease has run out', async () => {
    const id = await queued();
    expect((await claimNextAffidavit())!.id).toBe(id);
    expect(await claimNextAffidavit()).toBeNull();

    await db.execute(sql`UPDATE candidate_affidavits SET lease_expires_at = now() - interval '1 minute' WHERE id = ${id}`);
    const again = await claimNextAffidavit();
    expect(again).toMatchObject({ id, attempts: 2 });
  });
});

describe('resolveWard', () => {
  it('resolves a corporation and number to the ward id', async () => {
    expect(await resolveWard({ status: 'value', number: 990, name: null, corporation: 'south' })).toBe(WARD_SOUTH.id);
  });

  it('resolves a number and matching name when the corporation is missing', async () => {
    expect(await resolveWard({ status: 'value', number: 991, name: 'queue test ward BETA', corporation: null })).toBe(WARD_WEST.id);
  });

  it('resolves when the affidavit repeats the ward number in front of the name', async () => {
    expect(await resolveWard({ status: 'value', number: 991, name: '991 - Queue Test Ward Beta', corporation: null })).toBe(WARD_WEST.id);
    expect(await resolveWard({ status: 'value', number: 991, name: 'Ward No. 991 Queue Test Ward Beta', corporation: null })).toBeNull();
  });

  it.each([
    ['a corporation with no such ward', { status: 'value', number: 990, name: null, corporation: 'north' }],
    ['a number alone', { status: 'value', number: 991, name: null, corporation: null }],
    ['a number with the wrong name', { status: 'value', number: 991, name: 'Somewhere Else', corporation: null }],
    ['a ward that is not declared', { status: 'not_declared', number: null, name: null, corporation: null }],
  ] as const)('does not resolve %s', async (_name, ward) => {
    expect(await resolveWard(ward)).toBeNull();
  });
});

describe('processOne', () => {
  it('returns false when nothing is waiting', async () => {
    expect(await processOne(ok(extraction()))).toBe(false);
  });

  it('creates and publishes the candidate when the ward resolves', async () => {
    const id = await queued();
    const e = extraction();
    expect(await processOne(ok(e))).toBe(true);

    const row = await affidavit(id);
    expect(row).toMatchObject({ state: 'published', confidence: 64, leaseExpiresAt: null, failure: null });
    expect(row.extraction).toEqual(e);

    const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, row.candidateId!));
    expect(candidate).toMatchObject({ wardId: WARD_SOUTH.id, nameEn: e.identity.name.text, partyEn: 'Demo Party A', status: 'filed' });
    expect(candidate.slug.startsWith(`${WARD_SOUTH.id}-queue-person-`)).toBe(true);

    const fields = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidate.id));
    expect(fields.map((f) => f.fieldKey).sort()).toEqual(['age', 'assets', 'cases', 'education', 'full_name', 'gender', 'party', 'ward']);
    expect(fields.every((f) => f.aiExtracted)).toBe(true);
    expect(fields.find((f) => f.fieldKey === 'cases')!.unreadable).toBe(true);
    const [stored] = await db.select().from(schema.media).where(eq(schema.media.id, row.mediaId));
    expect(fields.find((f) => f.fieldKey === 'age')!.sourceUrl).toBe(`/media/${stored.id}/${stored.sha256.slice(0, 16)}`);
  });

  it('publishes nothing and waits for an admin when the ward does not resolve', async () => {
    const id = await queued();
    const e = extraction({ ward: { status: 'not_declared', number: null, name: null, corporation: null } });
    await processOne(ok(e));
    const row = await affidavit(id);
    expect(row).toMatchObject({ state: 'needs_matching', matchReason: 'ward_unresolved', candidateId: null, confidence: 64 });
    expect(row.extraction).toEqual(e);
  });

  it('waits for an admin when the name could not be read', async () => {
    const id = await queued();
    await processOne(ok(extraction({ name: { status: 'unreadable', text: null } })));
    expect(await affidavit(id)).toMatchObject({ state: 'needs_matching', matchReason: 'ward_unresolved', candidateId: null });
  });

  it('never merges into a candidate of the same name in the same ward', async () => {
    const e = extraction();
    await queued();
    await processOne(ok(e));
    const second = await queued();
    const sameName = extraction({ name: { status: 'value', text: `  ${e.identity.name.text!.toUpperCase()} ` } });
    await processOne(ok(sameName));
    expect(await affidavit(second)).toMatchObject({ state: 'needs_matching', matchReason: 'possible_duplicate', candidateId: null });
  });

  it('publishes onto the candidate a curator uploaded it for, leaving their name and party alone', async () => {
    const [candidate] = await db
      .insert(schema.candidates)
      .values({ slug: `queue-preset-${randomUUID()}`, wardId: WARD_WEST.id, nameEn: 'Curator Named (FICTIONAL)', partyEn: 'Demo Party B' })
      .returning({ id: schema.candidates.id });
    const id = await queued({ candidateId: candidate.id });
    await processOne(ok(extraction({ ward: { status: 'not_declared', number: null, name: null, corporation: null } })));

    expect(await affidavit(id)).toMatchObject({ state: 'published', candidateId: candidate.id });
    const [after] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidate.id));
    expect(after).toMatchObject({ nameEn: 'Curator Named (FICTIONAL)', partyEn: 'Demo Party B', wardId: WARD_WEST.id });
    const keys = (await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidate.id))).map((f) => f.fieldKey).sort();
    expect(keys).toEqual(['age', 'assets', 'cases', 'education', 'gender']);
  });

  it(`retries a failed call and gives up after ${MAX_ATTEMPTS} attempts, publishing nothing`, async () => {
    const id = await queued();
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      await processOne(failing('api_error'));
      expect(await affidavit(id)).toMatchObject({ state: 'queued', attempts: attempt, leaseExpiresAt: null });
    }
    await processOne(failing('api_error'));
    const row = await affidavit(id);
    expect(row).toMatchObject({ state: 'failed', attempts: MAX_ATTEMPTS, candidateId: null, extraction: null });
    expect(row.failure).toBe('api_error: test api_error');
  });

  it('fails at once on a refusal', async () => {
    const id = await queued();
    await processOne(failing('refusal'));
    expect(await affidavit(id)).toMatchObject({ state: 'failed', attempts: 1 });
  });

  it('counts an extractor that throws as a failed attempt instead of stranding the row', async () => {
    const id = await queued();
    await processOne(async () => {
      throw new Error('socket hang up');
    });
    const row = await affidavit(id);
    expect(row).toMatchObject({ state: 'queued', attempts: 1, leaseExpiresAt: null });
    expect(row.failure).toContain('socket hang up');
  });
});
