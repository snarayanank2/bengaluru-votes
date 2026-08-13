/**
 * src/lib/extract.ts — AI extraction of report-card fields from a stored
 * affidavit PDF (Task 37; architecture §7/§13; PRD §5.2/§9.1).
 *
 * NEVER calls the real Anthropic API: every test injects a fake `extractor`
 * function directly into `extractAffidavitFields` (its mockable seam) — the
 * module's real `callExtractionModel` (which imports `@anthropic-ai/sdk`
 * and would need `ANTHROPIC_API_KEY`) is never invoked here.
 *
 * COVERAGE MAP:
 *   - happy path: three fields published, each `aiExtracted:true`,
 *     `sourceType:'official'`, `sourceUrl` the stored affidavit's media URL;
 *     `extractionStatus` -> 'done'; a system-actor audit row per field.
 *   - a `null` extracted field publishes `notDeclared:true` with the same
 *     affidavit source (PRD §9.1 — not declared is a complete answer).
 *   - a curator re-publishing an AI-extracted field clears the
 *     `aiExtracted` marker (Task 5's confirm-clears-marker rule) — proves
 *     `publishCandidateField`'s actor-role gate applies unchanged here.
 *   - a model failure sets `extractionStatus` to 'failed', publishes
 *     nothing, and rethrows.
 *   - Task 37 REVIEW FIX 1 (integrity-critical): a MALFORMED extractor
 *     output — a missing field, an extra key, or a non-string/non-null
 *     value — must become an extraction FAILURE (nothing published), never
 *     silently collapse into a legitimate `notDeclared`. Only an explicit
 *     `null` is "not declared"; anything else malformed is a parse failure.
 *   - Task 37 REVIEW FIX 2: the extraction publish's audit row always has
 *     `actorUserId: null` / `actorRole: 'system'`, even when the triggering
 *     curator's `userId` is passed into `extractAffidavitFields` — schema.ts's
 *     `audit_log.actor_user_id` convention ("null = system") is a system
 *     action regardless of who triggered the upload.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq, inArray } from 'drizzle-orm';
import crypto, { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

import { extractAffidavitFields, type AffidavitExtraction } from '../../src/lib/extract';
import { publishCandidateField } from '../../src/lib/publish';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific fixture id (Task 37 brief) — this suite owns 99440.
const WARD = {
  id: 99440,
  nameEn: 'Extract Test Ward',
  nameKn: 'ಹೊರತೆಗೆಯುವಿಕೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone X',
  boundaryRef: 'extract-test-ward',
};

const createdMediaIds: number[] = [];

/** Fresh candidate + affidavit media + pending candidate_affidavits row, isolated per test so field-publish assertions never collide across tests. */
async function setupFixture(): Promise<{ candidateId: number; mediaId: number }> {
  const [candidateRow] = await db
    .insert(schema.candidates)
    .values({
      slug: `extract-test-candidate-${randomUUID()}`,
      wardId: WARD.id,
      nameEn: 'Extract Test Candidate',
      partyEn: 'Independent',
    })
    .returning({ id: schema.candidates.id });
  const candidateId = candidateRow!.id;

  const pdfBytes = Buffer.from(`%PDF-1.4\nfixture-${randomUUID()}\n%%EOF`);
  const sha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex');
  const [mediaRow] = await db
    .insert(schema.media)
    .values({ bytes: pdfBytes, contentType: 'application/pdf', sha256, size: pdfBytes.length })
    .returning({ id: schema.media.id });
  const mediaId = mediaRow!.id;
  createdMediaIds.push(mediaId);

  await db.insert(schema.candidateAffidavits).values({
    candidateId,
    mediaId,
    originUrl: null,
    extractionStatus: 'pending',
  });

  return { candidateId, mediaId };
}

async function cleanup(): Promise<void> {
  const candidateRows = await db.select({ id: schema.candidates.id }).from(schema.candidates).where(eq(schema.candidates.wardId, WARD.id));
  const candidateIds = candidateRows.map((c) => c.id);

  if (candidateIds.length > 0) {
    await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
    await db.delete(schema.candidateAffidavits).where(inArray(schema.candidateAffidavits.candidateId, candidateIds));
  }
  if (createdMediaIds.length > 0) {
    await db.delete(schema.media).where(inArray(schema.media.id, createdMediaIds));
    createdMediaIds.length = 0;
  }
  await db.delete(schema.auditLog).where(eq(schema.auditLog.wardId, WARD.id));
  await db.delete(schema.candidates).where(eq(schema.candidates.wardId, WARD.id));
}

describe('extractAffidavitFields (Task 37)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await db.delete(schema.wards).where(eq(schema.wards.id, WARD.id));
    await client.end();
  });

  it('publishes cases/assets/education as aiExtracted, sourced from the affidavit; sets extractionStatus done; audits as system', async () => {
    const { candidateId, mediaId } = await setupFixture();
    const extractor = vi.fn(
      async (_pdfBytes: Buffer): Promise<AffidavitExtraction> => ({
        cases: '2 pending cases',
        assets: '₹1.2 cr',
        education: 'Graduate',
      }),
    );

    await extractAffidavitFields(mediaId, candidateId, { userId: null }, extractor);

    expect(extractor).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(extractor.mock.calls[0][0])).toBe(true);

    const fieldRows = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId));
    const byKey = new Map(fieldRows.map((f) => [f.fieldKey, f]));

    const expected: Record<string, string> = { cases: '2 pending cases', assets: '₹1.2 cr', education: 'Graduate' };
    for (const [key, value] of Object.entries(expected)) {
      const row = byKey.get(key);
      expect(row, `expected a candidate_fields row for ${key}`).toBeDefined();
      expect(row!.valueEn).toBe(value);
      expect(row!.notDeclared).toBe(false);
      expect(row!.aiExtracted).toBe(true);
      expect(row!.sourceType).toBe('official');
      expect(row!.sourceUrl).toBe(`/media/${mediaId}/${(await mediaHash(mediaId)).slice(0, 16)}`);
    }

    const [affidavitRow] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.mediaId, mediaId));
    expect(affidavitRow!.extractionStatus).toBe('done');

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.actorRole, 'system'), eq(schema.auditLog.wardId, WARD.id)));
    expect(auditRows.length).toBeGreaterThanOrEqual(3);
    expect(auditRows.every((r) => r.actorUserId === null)).toBe(true);
  });

  it('a null extracted field publishes notDeclared:true with the affidavit as its source', async () => {
    const { candidateId, mediaId } = await setupFixture();
    const extractor = vi.fn(
      async (_pdfBytes: Buffer): Promise<AffidavitExtraction> => ({ cases: null, assets: 'Some declared assets', education: 'Graduate' }),
    );

    await extractAffidavitFields(mediaId, candidateId, { userId: null }, extractor);

    const [casesRow] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'cases')));
    expect(casesRow!.notDeclared).toBe(true);
    expect(casesRow!.valueEn).toBeNull();
    expect(casesRow!.aiExtracted).toBe(true);
    expect(casesRow!.sourceType).toBe('official');
    expect(casesRow!.sourceUrl).toBe(`/media/${mediaId}/${(await mediaHash(mediaId)).slice(0, 16)}`);
  });

  it('a curator re-publishing an AI-extracted field clears the aiExtracted marker (Task 5 rule)', async () => {
    const { candidateId, mediaId } = await setupFixture();
    const extractor = vi.fn(async (_pdfBytes: Buffer): Promise<AffidavitExtraction> => ({ cases: 'AI-extracted cases text', assets: null, education: null }));

    await extractAffidavitFields(mediaId, candidateId, { userId: null }, extractor);

    const [before] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'cases')));
    expect(before!.aiExtracted).toBe(true);

    await publishCandidateField(
      { userId: 555555, role: 'curator' },
      {
        candidateId,
        fieldKey: 'cases',
        valueEn: 'Curator-confirmed cases text',
        notDeclared: false,
        sourceUrl: before!.sourceUrl,
        sourceType: 'official',
        authoredLang: 'en',
        aiExtracted: true, // even requesting true, a non-system actor never sticks it
      },
    );

    const [after] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'cases')));
    expect(after!.aiExtracted).toBe(false);
    expect(after!.valueEn).toBe('Curator-confirmed cases text');
  });

  it('a model failure sets extractionStatus failed, publishes nothing, and rethrows', async () => {
    const { candidateId, mediaId } = await setupFixture();
    const extractor = vi.fn(async (_pdfBytes: Buffer): Promise<AffidavitExtraction> => {
      throw new Error('model unavailable');
    });

    await expect(extractAffidavitFields(mediaId, candidateId, { userId: null }, extractor)).rejects.toThrow('model unavailable');

    const [affidavitRow] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.mediaId, mediaId));
    expect(affidavitRow!.extractionStatus).toBe('failed');

    const fieldRows = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId));
    expect(fieldRows.length).toBe(0);
  });

  it('Fix 1: a missing field in the extractor output is an extraction FAILURE, not notDeclared — publishes nothing', async () => {
    const { candidateId, mediaId } = await setupFixture();
    // `education` key entirely absent — not the same as an explicit `null`.
    const extractor = vi.fn(async (_pdfBytes: Buffer): Promise<unknown> => ({ cases: 'some cases', assets: 'some assets' }));

    const before = (await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId))).length;
    expect(before).toBe(0);

    await expect(extractAffidavitFields(mediaId, candidateId, { userId: null }, extractor)).rejects.toThrow();

    const [affidavitRow] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.mediaId, mediaId));
    expect(affidavitRow!.extractionStatus).toBe('failed');

    const after = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId));
    expect(after.length).toBe(0);
  });

  it('Fix 1: an extra key in the extractor output is an extraction FAILURE — publishes nothing', async () => {
    const { candidateId, mediaId } = await setupFixture();
    const extractor = vi.fn(
      async (_pdfBytes: Buffer): Promise<unknown> => ({ cases: 'some cases', assets: 'some assets', education: 'Graduate', extraField: 'sneaky' }),
    );

    await expect(extractAffidavitFields(mediaId, candidateId, { userId: null }, extractor)).rejects.toThrow();

    const [affidavitRow] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.mediaId, mediaId));
    expect(affidavitRow!.extractionStatus).toBe('failed');

    const fieldRows = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId));
    expect(fieldRows.length).toBe(0);
  });

  it('Fix 1: a non-string, non-null value (e.g. {cases: 42}) is an extraction FAILURE — publishes nothing', async () => {
    const { candidateId, mediaId } = await setupFixture();
    const extractor = vi.fn(async (_pdfBytes: Buffer): Promise<unknown> => ({ cases: 42, assets: 'some assets', education: 'Graduate' }));

    await expect(extractAffidavitFields(mediaId, candidateId, { userId: null }, extractor)).rejects.toThrow();

    const [affidavitRow] = await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.mediaId, mediaId));
    expect(affidavitRow!.extractionStatus).toBe('failed');

    const fieldRows = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId));
    expect(fieldRows.length).toBe(0);
  });

  it('Fix 1: all-valid strings for all three fields publish all three (the legitimate happy path still works)', async () => {
    const { candidateId, mediaId } = await setupFixture();
    const extractor = vi.fn(async (_pdfBytes: Buffer): Promise<AffidavitExtraction> => ({ cases: 'a', assets: 'b', education: 'c' }));

    await extractAffidavitFields(mediaId, candidateId, { userId: null }, extractor);

    const fieldRows = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId));
    expect(fieldRows.length).toBe(3);
    expect(fieldRows.every((f) => f.notDeclared === false)).toBe(true);
  });

  it('Fix 2: the extraction publish audits actorUserId=null/actorRole=system even when a curator userId triggered it', async () => {
    const { candidateId, mediaId } = await setupFixture();
    const extractor = vi.fn(async (_pdfBytes: Buffer): Promise<AffidavitExtraction> => ({ cases: 'x', assets: null, education: null }));

    // A real curator's userId is passed in as the triggering actor...
    await extractAffidavitFields(mediaId, candidateId, { userId: 424242 }, extractor);

    // ...but the extraction PUBLISH's own audit row must still be system/null.
    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entityType, 'candidate_field'),
          eq(schema.auditLog.entityId, `${candidateId}:cases`),
        ),
      );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    for (const row of auditRows) {
      expect(row.actorUserId).toBeNull();
      expect(row.actorRole).toBe('system');
    }
  });

  it('a failure on one affidavit does not corrupt fields already published for another candidate', async () => {
    const good = await setupFixture();
    const goodExtractor = vi.fn(async (_pdfBytes: Buffer): Promise<AffidavitExtraction> => ({ cases: 'fine', assets: 'fine', education: 'fine' }));
    await extractAffidavitFields(good.mediaId, good.candidateId, { userId: null }, goodExtractor);

    const bad = await setupFixture();
    const badExtractor = vi.fn(async (_pdfBytes: Buffer): Promise<AffidavitExtraction> => {
      throw new Error('boom');
    });
    await expect(extractAffidavitFields(bad.mediaId, bad.candidateId, { userId: null }, badExtractor)).rejects.toThrow('boom');

    const goodFields = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, good.candidateId));
    expect(goodFields.length).toBe(3);
    expect(goodFields.every((f) => f.aiExtracted)).toBe(true);
  });
});

async function mediaHash(mediaId: number): Promise<string> {
  const [row] = await db.select({ sha256: schema.media.sha256 }).from(schema.media).where(eq(schema.media.id, mediaId));
  return row!.sha256;
}
