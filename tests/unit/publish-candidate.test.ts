/**
 * Task 36 (candidate editor) — the src/lib/publish.ts extensions that don't
 * need an HTTP round trip to exercise: `publishCandidateCore`,
 * `createCandidate` (+ its slug scheme), and `publishStance`. The
 * source-required / scope / photo-upload / CSRF behaviors live in the
 * route-level suite, tests/routes/curator-candidate.test.ts, since those
 * need the real middleware + multipart form parsing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { createCandidate, publishCandidateCore, publishStance } from '../../src/lib/publish';
import { randomUUID } from 'node:crypto';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward ids (Task 36 brief) — the route suite
// (tests/routes/curator-candidate.test.ts) owns 99420-99429; this
// lib-level suite owns 99430-99439.
const WARD_SIGNED_OFF = {
  id: 99430,
  nameEn: 'Publish Candidate Test Ward Signed Off',
  nameKn: 'ಪ್ರಕಟಣೆ ಅಭ್ಯರ್ಥಿ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'publish-candidate-test-ward-signed-off',
};
const WARD_PLAIN = {
  id: 99431,
  nameEn: 'Publish Candidate Test Ward Plain',
  nameKn: 'ಪ್ರಕಟಣೆ ಅಭ್ಯರ್ಥಿ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಬಿ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'publish-candidate-test-ward-plain',
};
const WARD_OTHER = {
  id: 99432,
  nameEn: 'Publish Candidate Test Ward Other',
  nameKn: 'ಪ್ರಕಟಣೆ ಅಭ್ಯರ್ಥಿ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಸಿ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'publish-candidate-test-ward-other',
};
const ALL_WARDS = [WARD_SIGNED_OFF, WARD_PLAIN, WARD_OTHER];

const ACTOR = { userId: 88801, role: 'curator' as const };

describe('src/lib/publish.ts — publishCandidateCore / createCandidate / publishStance (Task 36)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }
  });

  afterAll(async () => {
    const issueRows = await db
      .select({ id: schema.wardIssues.id })
      .from(schema.wardIssues)
      .where(inArray(schema.wardIssues.wardId, ALL_WARDS.map((w) => w.id)));
    const issueIds = issueRows.map((r) => r.id);
    if (issueIds.length > 0) {
      await db.delete(schema.candidateStances).where(inArray(schema.candidateStances.wardIssueId, issueIds));
    }
    await db.delete(schema.wardIssues).where(inArray(schema.wardIssues.wardId, ALL_WARDS.map((w) => w.id)));
    await db.delete(schema.candidates).where(inArray(schema.candidates.wardId, ALL_WARDS.map((w) => w.id)));
    await client.end();
  });

  describe('publishCandidateCore — core edits and status transitions', () => {
    let candidateId: number;

    beforeAll(async () => {
      const [row] = await db
        .insert(schema.candidates)
        .values({
          slug: `publish-core-test-${randomUUID()}`,
          wardId: WARD_SIGNED_OFF.id,
          nameEn: 'Core Test Candidate',
          partyEn: 'Independent',
          status: 'filed',
        })
        .returning({ id: schema.candidates.id });
      candidateId = row!.id;
    });

    it('a core edit that does NOT touch status updates the field and leaves status alone', async () => {
      await publishCandidateCore(ACTOR, { candidateId, partyEn: 'Renamed Party' });

      const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateId));
      expect(candidate?.partyEn).toBe('Renamed Party');
      expect(candidate?.status).toBe('filed');
    });

    it('a STATUS transition is written', async () => {
      await publishCandidateCore(ACTOR, { candidateId, status: 'contesting' });

      const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateId));
      expect(candidate?.status).toBe('contesting');
    });
  });

  describe('createCandidate — status default; slug scheme', () => {
    it('a new candidate starts as filed', async () => {
      const { id } = await createCandidate(ACTOR, { wardId: WARD_PLAIN.id, nameEn: 'Fresh Filing', partyEn: 'Independent' });
      expect(id).toBeGreaterThan(0);

      const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, id));
      expect(candidate?.status).toBe('filed');
    });

    it('slug is `{wardId}-{name-slug}`; a second same-named candidate in the SAME ward gets a -2 suffix', async () => {
      const first = await createCandidate(ACTOR, { wardId: WARD_PLAIN.id, nameEn: 'Ramesh Kumar', partyEn: 'Independent' });
      expect(first.slug).toBe(`${WARD_PLAIN.id}-ramesh-kumar`);

      const second = await createCandidate(ACTOR, { wardId: WARD_PLAIN.id, nameEn: 'Ramesh Kumar', partyEn: 'Independent' });
      expect(second.slug).toBe(`${WARD_PLAIN.id}-ramesh-kumar-2`);
      expect(second.id).not.toBe(first.id);
    });

    it('the SAME name in a DIFFERENT ward gets a different (ward-prefixed) slug — no collision', async () => {
      const inPlainWard = await createCandidate(ACTOR, { wardId: WARD_PLAIN.id, nameEn: 'Suresh Rao', partyEn: 'Independent' });
      const inOtherWard = await createCandidate(ACTOR, { wardId: WARD_OTHER.id, nameEn: 'Suresh Rao', partyEn: 'Independent' });

      expect(inPlainWard.slug).toBe(`${WARD_PLAIN.id}-suresh-rao`);
      expect(inOtherWard.slug).toBe(`${WARD_OTHER.id}-suresh-rao`);
      expect(inPlainWard.slug).not.toBe(inOtherWard.slug);
    });

    it('slug is stable on rename — publishCandidateCore never touches slug', async () => {
      const created = await createCandidate(ACTOR, { wardId: WARD_OTHER.id, nameEn: 'Original Name', partyEn: 'Independent' });

      await publishCandidateCore(ACTOR, { candidateId: created.id, nameEn: 'Renamed After Filing' });

      const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, created.id));
      expect(candidate?.nameEn).toBe('Renamed After Filing');
      expect(candidate?.slug).toBe(created.slug);
    });
  });

  describe('publishStance — upserts candidate_stances, audited atomically', () => {
    it('writes the stance row and an audit entry; a second publish updates in place (upsert)', async () => {
      const candidate = await createCandidate(ACTOR, { wardId: WARD_OTHER.id, nameEn: 'Stance Test Candidate', partyEn: 'Independent' });
      const [issue] = await db
        .insert(schema.wardIssues)
        .values({ wardId: WARD_OTHER.id, titleEn: 'Roads', authoredLang: 'en' })
        .returning({ id: schema.wardIssues.id });
      const wardIssueId = issue!.id;

      await publishStance(ACTOR, {
        wardIssueId,
        candidateId: candidate.id,
        valueEn: 'Will prioritize pothole repair.',
        sourceUrl: 'https://example.org/stance-source',
        sourceType: 'curator',
        authoredLang: 'en',
      });

      const [stance] = await db
        .select()
        .from(schema.candidateStances)
        .where(and(eq(schema.candidateStances.wardIssueId, wardIssueId), eq(schema.candidateStances.candidateId, candidate.id)));
      expect(stance?.valueEn).toBe('Will prioritize pothole repair.');

      await publishStance(ACTOR, {
        wardIssueId,
        candidateId: candidate.id,
        valueEn: 'Updated stance.',
        sourceUrl: 'https://example.org/stance-source-2',
        sourceType: 'official',
        authoredLang: 'en',
      });

      const [updated] = await db
        .select()
        .from(schema.candidateStances)
        .where(and(eq(schema.candidateStances.wardIssueId, wardIssueId), eq(schema.candidateStances.candidateId, candidate.id)));
      expect(updated?.valueEn).toBe('Updated stance.');
      expect(updated?.sourceType).toBe('official');

    });
  });
});
