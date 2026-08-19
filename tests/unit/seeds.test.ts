import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { seedWards, loadCityIssueRows, loadWardCandidateQuestionRows, loadWardFactRows, loadWardRows } from '../../scripts/seed-wards';
import { seedAdmin, isValidEmail } from '../../scripts/seed-admin';
import { seedDev, assertNotProduction } from '../../scripts/seed-dev';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

describe('seed-wards', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  it('loads 369 rows from the geojson with non-empty nameKn and a valid corporation', () => {
    const rows = loadWardRows();
    expect(rows.length).toBe(369);
    for (const row of rows) {
      expect(row.nameKn).toBeTruthy();
      expect(row.nameEn).toBeTruthy();
      expect(['north', 'south', 'east', 'west', 'central']).toContain(row.corporation);
      expect(row.zone).toBeTruthy();
      expect(row.boundaryRef).toBeTruthy();
      expect(row.assemblyNumber).toBeTypeOf('number');
      expect(row.assemblyNameEn).toBeTruthy();
      expect(row.assemblyNameKn).toBeTruthy();
      expect(row.populationTotal).toBeGreaterThan(0);
      expect(row.populationMale).toBeGreaterThan(0);
      expect(row.populationFemale).toBeGreaterThan(0);
      expect(row.reservationEn).toBeTruthy();
      expect(row.reservationKn).toBeTruthy();
      expect(row.factsSourceUrl).toBeTruthy();
      expect(row.factsSourceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.size).toBe(369);
  });

  it('maps bilingual old-ward overlaps and key areas to all wards', () => {
    const { overlaps, keyAreas } = loadWardFactRows();
    expect(new Set(overlaps.map((row) => row.wardId)).size).toBe(369);
    // The upstream source leaves key areas blank for 56 wards.
    expect(new Set(keyAreas.map((row) => row.wardId)).size).toBe(313);
    expect(overlaps.every((row) => row.oldWardNameEn && row.oldWardNameKn)).toBe(true);
    expect(keyAreas.every((row) => row.nameEn && row.nameKn)).toBe(true);
    expect(overlaps.every((row) => row.publishedOverlapBasisPoints >= 0 && row.publishedOverlapBasisPoints <= 10_000)).toBe(true);
  });

  it('maps five bilingual candidate questions to every ward', () => {
    const rows = loadWardCandidateQuestionRows();
    expect(rows).toHaveLength(369 * 5);
    expect(new Set(rows.map((row) => row.wardId)).size).toBe(369);
    for (const row of rows) {
      expect(row.position).toBeGreaterThanOrEqual(1);
      expect(row.position).toBeLessThanOrEqual(5);
      expect(row.questionEn).toBeTruthy();
      expect(row.questionKn).toBeTruthy();
    }
  });

  it('maps the same 20 bilingual catalog issues to every ward', () => {
    const rows = loadCityIssueRows();
    expect(rows).toHaveLength(369 * 20);
    expect(new Set(rows.map((row) => row.wardId)).size).toBe(369);
    expect(new Set(rows.filter((row) => row.wardId === rows[0].wardId).map((row) => row.catalogKey)).size).toBe(20);
    expect(rows.every((row) => row.titleEn && row.titleKn)).toBe(true);
  });

  it('inserts 369 wards into the db with non-empty name_kn, and is idempotent', async () => {
    const count = await seedWards(db);
    expect(count).toBe(369);

    // Running again must not fail and must not create duplicates.
    await seedWards(db);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.wards);
    expect(total).toBeGreaterThanOrEqual(369);

    const rows = await db.select().from(schema.wards);
    const seeded = rows.filter((r) => r.boundaryRef.startsWith('ward_369_final.'));
    expect(seeded.length).toBe(369);
    for (const row of seeded) {
      expect(row.nameKn).toBeTruthy();
      expect(row.nameKn.length).toBeGreaterThan(0);
    }

    const questionRows = await db
      .select()
      .from(schema.wardCandidateQuestions)
      .where(inArray(schema.wardCandidateQuestions.wardId, seeded.map((row) => row.id)));
    expect(questionRows).toHaveLength(369 * 5);
    const issueRows = await db.select().from(schema.wardIssues).where(inArray(schema.wardIssues.wardId, seeded.map((row) => row.id)));
    expect(issueRows.filter((row) => row.catalogKey !== null)).toHaveLength(369 * 20);
    const overlapRows = await db.select().from(schema.wardOldWardOverlaps)
      .where(inArray(schema.wardOldWardOverlaps.wardId, seeded.map((row) => row.id)));
    const keyAreaRows = await db.select().from(schema.wardKeyAreas)
      .where(inArray(schema.wardKeyAreas.wardId, seeded.map((row) => row.id)));
    expect(new Set(overlapRows.map((row) => row.wardId)).size).toBe(369);
    expect(new Set(keyAreaRows.map((row) => row.wardId)).size).toBe(313);
  });
});

describe('seed-admin', () => {
  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.email, 'seed-admin-test@example.org'));
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('ok@example.org')).toBe(true);
  });

  it('is idempotent: running twice results in exactly one row with role admin', async () => {
    const email = 'seed-admin-test@example.org';

    const id1 = await seedAdmin(db, email);
    const id2 = await seedAdmin(db, email);
    expect(id2).toBe(id1);

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe('admin');
  });

  it('throws on an invalid email instead of writing a row', async () => {
    await expect(seedAdmin(db, 'not-an-email')).rejects.toThrow();
  });
});

describe('seed-dev', () => {
  beforeAll(async () => {
    // seed-dev depends on wards existing.
    await seedWards(db);
  });

  it('refuses to run when NODE_ENV=production', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow();
    expect(() => assertNotProduction({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('seeds two bilingual fictional candidates with nine fields in all 369 wards', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const result = await seedDev(db);
      expect(result.wardIds).toHaveLength(369);
      expect(result.candidateCount).toBe(369 * 2);
      expect(result.issueCount).toBe(3);

      const candidates = await db
        .select()
        .from(schema.candidates)
        .where(eq(schema.candidates.wardId, result.wardIds[0]));
      const demoCandidates = candidates.filter((c) => c.slug.startsWith('demo-ward-'));
      expect(demoCandidates).toHaveLength(2);
      for (const c of demoCandidates) {
        expect(c.nameEn).toMatch(/FICTIONAL/);
        expect(c.nameKn).toMatch(/ಕಾಲ್ಪನಿಕ/);
        expect(c.partyEn).toMatch(/FICTIONAL/);
        expect(c.partyKn).toMatch(/ಕಾಲ್ಪನಿಕ/);

        const fields = await db
          .select()
          .from(schema.candidateFields)
          .where(eq(schema.candidateFields.candidateId, c.id));
        expect(new Set(fields.map((field) => field.fieldKey))).toEqual(
          new Set(['full_name', 'ward', 'party', 'gender', 'age', 'education', 'assets', 'cases', 'ec_affidavit']),
        );
        expect(fields.some((field) => field.aiExtracted)).toBe(true);
        expect(fields.some((field) => !field.aiExtracted)).toBe(true);

        const affidavits = await db
          .select()
          .from(schema.candidateAffidavits)
          .where(eq(schema.candidateAffidavits.candidateId, c.id));
        expect(affidavits).toHaveLength(1);
      }

      const secondRun = await seedDev(db);
      expect(secondRun.candidateCount).toBe(369 * 2);
      const candidatesAfterSecondRun = await db
        .select()
        .from(schema.candidates)
        .where(eq(schema.candidates.wardId, result.wardIds[0]));
      expect(candidatesAfterSecondRun.filter((c) => c.slug.startsWith('demo-ward-'))).toHaveLength(2);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
