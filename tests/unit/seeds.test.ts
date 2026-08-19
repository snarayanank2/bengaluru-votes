import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { seedWards, loadCityIssueRows, loadWardCandidateQuestionRows, loadWardRows } from '../../scripts/seed-wards';
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
    }
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.size).toBe(369);
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

  it('seeds fictional candidates and ward issues for a few real wards', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const result = await seedDev(db);
      expect(result.wardIds.length).toBeGreaterThan(0);
      expect(result.candidateCount).toBeGreaterThan(0);

      const candidates = await db
        .select()
        .from(schema.candidates)
        .where(eq(schema.candidates.wardId, result.wardIds[0]));
      const demoCandidates = candidates.filter((c) => c.slug.startsWith('demo-ward-'));
      expect(demoCandidates.length).toBeGreaterThan(0);
      for (const c of demoCandidates) {
        expect(c.nameEn).toMatch(/FICTIONAL/);
      }
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
