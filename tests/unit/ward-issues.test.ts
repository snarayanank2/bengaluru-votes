/**
 * Task 39 — src/lib/ward-issues.ts: the curator ward-issues editor's engine
 * (add/rename/remove), PRD §5.4/§5.5.
 *
 * VOTE SEMANTICS (the load-bearing behavior this suite exists to pin down):
 *   - RENAME updates the title IN PLACE — the `ward_issues.id` never
 *     changes, so an `issue_vote_selections` row referencing it (a
 *     citizen's cast vote) survives a rename untouched. Votes are NOT lost
 *     when a curator retitles an issue.
 *   - REMOVE deletes the `ward_issues` row outright, which FK-cascades its
 *     `issue_vote_selections` rows away — but a citizen's OTHER selections
 *     in the SAME vote set (for issues that were not removed) are left
 *     alone (PRD §5.5: "delete cascades selections + remaining stand").
 *
 * Curators are city-wide: the curator here has no ward assignment of any
 * kind and can still edit issues in any ward.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

import { addWardIssue, renameWardIssue, removeWardIssue, listWardIssues } from '../../src/lib/ward-issues';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward ids (Task 39 brief) — readiness.test.ts owns
// 99480-99492; this suite owns 99493-99499.
const WARD_A = {
  id: 99493,
  nameEn: 'Ward Issues Test Ward A',
  nameKn: 'ವಾರ್ಡ್ ಸಮಸ್ಯೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone W',
  boundaryRef: 'ward-issues-lib-test-a',
};
const WARD_B = {
  id: 99494,
  nameEn: 'Ward Issues Test Ward B',
  nameKn: 'ವಾರ್ಡ್ ಸಮಸ್ಯೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಬಿ',
  corporation: 'south' as const,
  zone: 'Zone W',
  boundaryRef: 'ward-issues-lib-test-b',
};
const ALL_WARDS = [WARD_A, WARD_B];
const ALL_WARD_IDS = ALL_WARDS.map((w) => w.id);

const EMAILS = { curator: 'ward-issues-lib-test-curator@example.com' };
const ACTOR_CURATOR = { role: 'curator' as const, userId: 0 }; // userId patched in beforeAll
const ACTOR_ADMIN = { userId: 999999, role: 'admin' as const };

let curatorId: number;

async function resetFixtures(): Promise<void> {
  const issueRows = await db
    .select({ id: schema.wardIssues.id })
    .from(schema.wardIssues)
    .where(inArray(schema.wardIssues.wardId, ALL_WARD_IDS));
  const issueIds = issueRows.map((r) => r.id);
  if (issueIds.length > 0) {
    await db.delete(schema.issueVoteSelections).where(inArray(schema.issueVoteSelections.wardIssueId, issueIds));
    await db.delete(schema.candidateStances).where(inArray(schema.candidateStances.wardIssueId, issueIds));
  }
  await db.delete(schema.wardIssues).where(inArray(schema.wardIssues.wardId, ALL_WARD_IDS));
  await db.delete(schema.issueVoteSets).where(inArray(schema.issueVoteSets.wardId, ALL_WARD_IDS));
}

describe('src/lib/ward-issues.ts (Task 39) — add/rename/remove, PRD §5.4/§5.5', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    const [curator] = await db
      .insert(schema.users)
      .values({ email: EMAILS.curator, role: 'curator', status: 'active' })
      .onConflictDoUpdate({ target: schema.users.email, set: { role: 'curator', status: 'active' } })
      .returning({ id: schema.users.id });
    curatorId = curator!.id;
    ACTOR_CURATOR.userId = curatorId;

    await resetFixtures();
  });

  afterAll(async () => {
    await resetFixtures();
    await db.delete(schema.users).where(eq(schema.users.id, curatorId));
    await client.end();
  });

  describe('addWardIssue', () => {
    it('inserts with position incrementing, authoredLang en, translationStatus pending; audit-logged', async () => {
      const { id: firstId } = await addWardIssue(ACTOR_CURATOR, WARD_A.id, 'Roads');
      const { id: secondId } = await addWardIssue(ACTOR_CURATOR, WARD_A.id, 'Water supply');

      const [first] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.id, firstId));
      const [second] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.id, secondId));

      expect(first?.titleEn).toBe('Roads');
      expect(first?.authoredLang).toBe('en');
      expect(first?.translationStatus).toBe('pending');
      expect(second!.position).toBeGreaterThan(first!.position);

    });

    it('curator can add to a second ward (city-wide)', async () => {
      const { id } = await addWardIssue(ACTOR_CURATOR, WARD_B.id, 'Curator-added issue');
      const after = await listWardIssues(WARD_B.id);
      expect(after.map((i) => i.id)).toContain(id);
    });

    it('admin can add to any ward', async () => {
      const { id } = await addWardIssue(ACTOR_ADMIN, WARD_B.id, 'Admin-added issue');
      const [row] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.id, id));
      expect(row?.titleEn).toBe('Admin-added issue');
    });
  });

  describe('renameWardIssue — id unchanged, votes preserved', () => {
    it('title changes, id unchanged, and a pre-existing issue_vote_selection referencing it still exists', async () => {
      const { id: issueId } = await addWardIssue(ACTOR_CURATOR, WARD_A.id, 'Original Title');

      // Simulate a citizen's existing cast vote referencing this issue.
      const [voter] = await db
        .insert(schema.users)
        .values({ email: 'ward-issues-lib-test-voter@example.com', role: 'citizen', status: 'active' })
        .onConflictDoUpdate({ target: schema.users.email, set: { role: 'citizen', status: 'active' } })
        .returning({ id: schema.users.id });
      // issue_vote_sets' uniqueness is a PARTIAL index (active-only, see
      // schema.ts), which onConflictDoUpdate can't target directly — clear
      // any leftover set for this fixture user first instead, so a rerun
      // after a failed prior run stays idempotent.
      await db.delete(schema.issueVoteSets).where(eq(schema.issueVoteSets.userId, voter!.id));
      const [voteSet] = await db
        .insert(schema.issueVoteSets)
        .values({ userId: voter!.id, wardId: WARD_A.id })
        .returning({ id: schema.issueVoteSets.id });
      await db.insert(schema.issueVoteSelections).values({ setId: voteSet!.id, wardIssueId: issueId });

      await renameWardIssue(ACTOR_CURATOR, issueId, 'Renamed Title');

      const [row] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.id, issueId));
      expect(row?.id).toBe(issueId);
      expect(row?.titleEn).toBe('Renamed Title');
      expect(row?.translationStatus).toBe('pending');

      const [selection] = await db
        .select()
        .from(schema.issueVoteSelections)
        .where(eq(schema.issueVoteSelections.wardIssueId, issueId));
      expect(selection).toBeDefined();
      expect(selection?.setId).toBe(voteSet!.id);

      // Cleanup this test's own vote fixtures so they don't leak into the
      // remove-cascade test below.
      await db.delete(schema.issueVoteSelections).where(eq(schema.issueVoteSelections.wardIssueId, issueId));
      await db.delete(schema.issueVoteSets).where(eq(schema.issueVoteSets.id, voteSet!.id));
      await db.delete(schema.users).where(eq(schema.users.id, voter!.id));
    });

    it('curator can rename an issue in a second ward (city-wide)', async () => {
      const { id: issueId } = await addWardIssue(ACTOR_ADMIN, WARD_B.id, 'Second Ward Issue');
      await renameWardIssue(ACTOR_CURATOR, issueId, 'Second Ward Issue Renamed');

      const [row] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.id, issueId));
      expect(row?.titleEn).toBe('Second Ward Issue Renamed');
    });
  });

  describe('removeWardIssue — cascades its own selections, leaves other issues in the same set alone', () => {
    it('the ward_issue is gone, its issue_vote_selections cascade-removed, but OTHER issues in the same vote set remain', async () => {
      const { id: issueToRemove } = await addWardIssue(ACTOR_CURATOR, WARD_A.id, 'Issue To Remove');
      const { id: issueToKeep } = await addWardIssue(ACTOR_CURATOR, WARD_A.id, 'Issue To Keep');

      const [voter] = await db
        .insert(schema.users)
        .values({ email: 'ward-issues-lib-test-voter-2@example.com', role: 'citizen', status: 'active' })
        .onConflictDoUpdate({ target: schema.users.email, set: { role: 'citizen', status: 'active' } })
        .returning({ id: schema.users.id });
      await db.delete(schema.issueVoteSets).where(eq(schema.issueVoteSets.userId, voter!.id));
      const [voteSet] = await db
        .insert(schema.issueVoteSets)
        .values({ userId: voter!.id, wardId: WARD_A.id })
        .returning({ id: schema.issueVoteSets.id });
      await db.insert(schema.issueVoteSelections).values([
        { setId: voteSet!.id, wardIssueId: issueToRemove },
        { setId: voteSet!.id, wardIssueId: issueToKeep },
      ]);

      await removeWardIssue(ACTOR_CURATOR, issueToRemove);

      const [removedIssueRow] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.id, issueToRemove));
      expect(removedIssueRow).toBeUndefined();

      const remainingSelections = await db
        .select()
        .from(schema.issueVoteSelections)
        .where(eq(schema.issueVoteSelections.setId, voteSet!.id));
      expect(remainingSelections).toHaveLength(1);
      expect(remainingSelections[0]?.wardIssueId).toBe(issueToKeep);

      await db.delete(schema.issueVoteSelections).where(eq(schema.issueVoteSelections.setId, voteSet!.id));
      await db.delete(schema.issueVoteSets).where(eq(schema.issueVoteSets.id, voteSet!.id));
      await db.delete(schema.users).where(eq(schema.users.id, voter!.id));
    });

    it('curator can remove an issue in a second ward (city-wide)', async () => {
      const { id: issueId } = await addWardIssue(ACTOR_ADMIN, WARD_B.id, 'To be removed');
      await removeWardIssue(ACTOR_CURATOR, issueId);

      const [row] = await db.select().from(schema.wardIssues).where(eq(schema.wardIssues.id, issueId));
      expect(row).toBeUndefined();
    });

    it('removing a non-existent issue throws (not a silent no-op)', async () => {
      await expect(removeWardIssue(ACTOR_CURATOR, 987654321)).rejects.toThrow();
    });
  });
});
