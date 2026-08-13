import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, and, sql } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { publishCandidateField } from '../../src/lib/publish';
import { randomUUID } from 'node:crypto';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

const WARD_ID = 9001;
let candidateId: number;

describe('append-only audit log + publish helper', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db.insert(schema.wards).values({
      id: WARD_ID,
      nameEn: 'Audit Test Ward',
      nameKn: 'ಆಡಿಟ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
      corporation: 'south',
      zone: 'Zone 9',
      boundaryRef: 'ward-audit-test',
    }).onConflictDoNothing();

    // audit_log is append-only (can't be cleaned between test runs), so each
    // run creates its own fresh candidate — a unique slug per run guarantees
    // a fresh candidateId, and hence entityIds that no prior run's audit
    // rows could collide with.
    const [candidate] = await db.insert(schema.candidates).values({
      slug: `audit-test-candidate-${randomUUID()}`,
      wardId: WARD_ID,
      nameEn: 'Test Candidate',
      partyEn: 'Independent',
    }).returning();

    candidateId = candidate.id;
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    // Clean slate for each test's field/audit rows so assertions don't
    // depend on ordering.
    await db.delete(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId));
    // audit_log is append-only; can't clean it up, tests scope assertions by
    // entityId instead.
  });

  it('(a) writes the field row and an audit row atomically', async () => {
    const entityId = `${candidateId}:track_record`;

    await publishCandidateField(
      { userId: 42, role: 'curator' },
      {
        candidateId,
        fieldKey: 'track_record',
        valueEn: 'Two term corporator, led road-repair drive.',
        sourceUrl: 'https://example.org/source',
        sourceType: 'curator',
        authoredLang: 'en',
      },
    );

    const [field] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'track_record')));

    expect(field).toBeDefined();
    expect(field.valueEn).toBe('Two term corporator, led road-repair drive.');
    expect(field.translationStatus).toBe('pending');
    expect(field.sourceType).toBe('curator');
    expect(field.aiExtracted).toBe(false);

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, entityId)));

    expect(auditRows.length).toBe(1);
    expect(auditRows[0].action).toBe('publish');
    expect(auditRows[0].actorRole).toBe('curator');
    expect(auditRows[0].actorUserId).toBe(42);
    expect(auditRows[0].wardId).toBe(WARD_ID);
    expect(auditRows[0].fieldKey).toBe('track_record');
    expect(auditRows[0].oldValue).toBeNull();
    expect((auditRows[0].newValue as { valueEn: string }).valueEn).toBe(
      'Two term corporator, led road-repair drive.',
    );
  });

  it('(b) rolls back the field write when the audit insert fails', async () => {
    // Honest failure: temporarily make audit_log also block INSERT (in
    // addition to the append-only UPDATE/DELETE rules already in place from
    // the migration). Postgres refuses INSERT ... RETURNING against a
    // relation whose applicable rule is an unconditional DO INSTEAD NOTHING
    // (it has no row to return), so this makes the audit insert itself
    // throw inside the transaction — proving publishCandidateField's
    // transaction rolls back the field write when the audit write fails.
    // (writeAudit's own .returning() guard — throwing when the insert
    // reports no row rather than erroring outright — is the same defence
    // for the sibling case where a write silently affects zero rows instead
    // of raising.)
    await db.execute(sql`CREATE RULE audit_log_no_insert AS ON INSERT TO audit_log DO INSTEAD NOTHING`);

    try {
      let caught: unknown;
      try {
        await publishCandidateField(
          { userId: 42, role: 'curator' },
          {
            candidateId,
            fieldKey: 'cases',
            valueEn: 'No pending cases.',
            sourceUrl: 'https://example.org/source',
            sourceType: 'curator',
            authoredLang: 'en',
          },
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      const rootCause = caught instanceof Error && caught.cause instanceof Error ? caught.cause.message : String(caught);
      expect(rootCause).toMatch(/cannot perform INSERT RETURNING/);

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'cases')));

      expect(field).toBeUndefined();
    } finally {
      await db.execute(sql`DROP RULE audit_log_no_insert ON audit_log`);
    }
  });

  it('(c) audit_log rejects UPDATE and DELETE (append-only rules)', async () => {
    await publishCandidateField(
      { userId: 7, role: 'admin' },
      {
        candidateId,
        fieldKey: 'assets',
        valueEn: 'Rs 10 lakh declared.',
        sourceUrl: 'https://example.org/source',
        sourceType: 'official',
        authoredLang: 'en',
      },
    );

    const entityId = `${candidateId}:assets`;

    const updateResult = await db.execute(
      sql`UPDATE audit_log SET action = 'tampered' WHERE entity_id = ${entityId}`,
    );
    expect(updateResult.count).toBe(0);

    const [stillOriginal] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, entityId));
    expect(stillOriginal.action).toBe('publish');

    const deleteResult = await db.execute(sql`DELETE FROM audit_log WHERE entity_id = ${entityId}`);
    expect(deleteResult.count).toBe(0);

    const [stillThere] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, entityId));
    expect(stillThere).toBeDefined();
  });
});
