import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, count, eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { issueResults, castVoteSet } from '../../src/lib/votes';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific id (task-20 brief) so this suite never collides with
// another test file's ward fixtures in the shared test DB.
const WARD_ID = 94001;
// A SECOND ward (Task 33) — exists only so an issue belonging to it can be
// used as a "not in wardId" fixture for castVoteSet's issue_not_in_ward check.
const OTHER_WARD_ID = 94002;

const WARD = {
  id: WARD_ID,
  nameEn: 'Issue Votes Test Ward',
  nameKn: 'ವಿಷಯ ಮತ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone V',
  boundaryRef: 'issue-votes-test-ward',
};

const OTHER_WARD = {
  id: OTHER_WARD_ID,
  nameEn: 'Issue Votes Other Test Ward',
  nameKn: 'ವಿಷಯ ಮತ ಇತರ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone V',
  boundaryRef: 'issue-votes-other-test-ward',
};

async function resetFixtures(): Promise<void> {
  // Order matters for FKs: selections -> sets -> issues (cascades stances) -> users.
  await db.execute(
    `delete from issue_vote_selections using issue_vote_sets where issue_vote_selections.set_id = issue_vote_sets.id and issue_vote_sets.ward_id in (${WARD_ID}, ${OTHER_WARD_ID})`,
  );
  await db.delete(schema.issueVoteSets).where(eq(schema.issueVoteSets.wardId, WARD_ID));
  await db.delete(schema.wardIssues).where(eq(schema.wardIssues.wardId, WARD_ID));
  await db.delete(schema.wardIssues).where(eq(schema.wardIssues.wardId, OTHER_WARD_ID));
  await db.delete(schema.users).where(eq(schema.users.email, 'votes-fixture-a@example.com'));
  await db.delete(schema.users).where(eq(schema.users.email, 'votes-fixture-b@example.com'));
  await db.delete(schema.users).where(eq(schema.users.email, 'votes-fixture-c@example.com'));
  await db.delete(schema.users).where(eq(schema.users.email, 'votes-fixture-d@example.com'));
}

async function makeUser(email: string, homeWardId: number = WARD_ID): Promise<number> {
  const [user] = await db
    .insert(schema.users)
    .values({ email, homeWardId })
    .onConflictDoUpdate({ target: schema.users.email, set: { homeWardId } })
    .returning({ id: schema.users.id });
  return user!.id;
}

/** Count of audit_log rows — used to assert castVoteSet never writes one (PRD §5.5's aggregated-public, never-per-citizen privacy decision). */
async function auditRowCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.auditLog);
  return row?.n ?? 0;
}

/** The single (guaranteed by active_set_uq) active set's selected issue ids for `userId`, or [] if none. */
async function activeSelections(userId: number): Promise<number[]> {
  const [set] = await db
    .select({ id: schema.issueVoteSets.id })
    .from(schema.issueVoteSets)
    .where(and(eq(schema.issueVoteSets.userId, userId), eq(schema.issueVoteSets.active, true)));
  if (!set) return [];
  const rows = await db
    .select({ wardIssueId: schema.issueVoteSelections.wardIssueId })
    .from(schema.issueVoteSelections)
    .where(eq(schema.issueVoteSelections.setId, set.id));
  return rows.map((r) => r.wardIssueId).sort((a, b) => a - b);
}

async function makeIssue(titleEn: string, position: number): Promise<number> {
  const [issue] = await db
    .insert(schema.wardIssues)
    .values({ wardId: WARD_ID, titleEn, titleKn: `${titleEn} (kn)`, position })
    .returning({ id: schema.wardIssues.id });
  return issue!.id;
}

async function makeVoteSet(userId: number, issueIds: number[], active: boolean): Promise<number> {
  const [set] = await db
    .insert(schema.issueVoteSets)
    .values({ userId, wardId: WARD_ID, active })
    .returning({ id: schema.issueVoteSets.id });
  for (const wardIssueId of issueIds) {
    await db.insert(schema.issueVoteSelections).values({ setId: set!.id, wardIssueId });
  }
  return set!.id;
}

describe('issueResults (src/lib/votes.ts) — PRD §5.5', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
    await db
      .insert(schema.wards)
      .values(OTHER_WARD)
      .onConflictDoUpdate({ target: schema.wards.id, set: OTHER_WARD });
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await resetFixtures();
  });

  it('returns [] when the ward has no issues defined', async () => {
    expect(await issueResults(WARD_ID)).toEqual([]);
  });

  it('zero total selections: every share is 0, ranked by curator position', async () => {
    const issueA = await makeIssue('Roads', 0);
    const issueB = await makeIssue('Water', 1);
    const issueC = await makeIssue('Waste', 2);

    const results = await issueResults(WARD_ID);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.sharePct === 0)).toBe(true);
    expect(results.map((r) => r.issueId)).toEqual([issueA, issueB, issueC]);
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('ranks by descending selection count and percentages sum to ~100 (active sets only)', async () => {
    const issueA = await makeIssue('Roads', 0); // most-selected
    const issueB = await makeIssue('Water', 1);
    const issueC = await makeIssue('Waste', 2); // zero selections

    const userA = await makeUser('votes-fixture-a@example.com');
    const userB = await makeUser('votes-fixture-b@example.com');
    const userC = await makeUser('votes-fixture-c@example.com');

    // Roads gets 3 selections (A, B, C), Water gets 1 (A), Waste gets 0.
    await makeVoteSet(userA, [issueA, issueB], true);
    await makeVoteSet(userB, [issueA], true);
    await makeVoteSet(userC, [issueA], true);

    const results = await issueResults(WARD_ID);
    expect(results).toHaveLength(3);

    const byId = new Map(results.map((r) => [r.issueId, r]));
    expect(byId.get(issueA)!.rank).toBe(1);
    expect(byId.get(issueB)!.rank).toBe(2);
    expect(byId.get(issueC)!.rank).toBe(3); // zero selections, still present, ranked last

    expect(byId.get(issueC)!.sharePct).toBe(0);
    expect(byId.get(issueA)!.titleEn).toBe('Roads');
    expect(byId.get(issueA)!.titleKn).toBe('Roads (kn)');

    const totalShare = results.reduce((sum, r) => sum + r.sharePct, 0);
    expect(totalShare).toBeGreaterThan(99);
    expect(totalShare).toBeLessThanOrEqual(100.1);
  });

  it('excludes a RETIRED (active=false) vote-set from the aggregate entirely', async () => {
    const issueA = await makeIssue('Roads', 0);
    const issueB = await makeIssue('Water', 1);

    const userA = await makeUser('votes-fixture-a@example.com');

    // Retired set voted for Water only — must not count.
    await makeVoteSet(userA, [issueB], false);
    // Active set (different user) voted for Roads only.
    const userB = await makeUser('votes-fixture-b@example.com');
    await makeVoteSet(userB, [issueA], true);

    const results = await issueResults(WARD_ID);
    const byId = new Map(results.map((r) => [r.issueId, r]));

    expect(byId.get(issueA)!.sharePct).toBe(100);
    expect(byId.get(issueB)!.sharePct).toBe(0);
    expect(byId.get(issueA)!.rank).toBe(1);
  });

  it('never exposes a raw count field on any returned result', async () => {
    const issueA = await makeIssue('Roads', 0);
    const userA = await makeUser('votes-fixture-a@example.com');
    await makeVoteSet(userA, [issueA], true);

    const results = await issueResults(WARD_ID);
    for (const r of results) {
      expect(Object.keys(r).sort()).toEqual(['issueId', 'rank', 'sharePct', 'titleEn', 'titleKn'].sort());
      expect('count' in r).toBe(false);
    }
  });

  it('deleting an issue: results are computed against the remaining issues only', async () => {
    const issueA = await makeIssue('Roads', 0);
    const issueB = await makeIssue('Water', 1);

    const userA = await makeUser('votes-fixture-a@example.com');
    await makeVoteSet(userA, [issueA, issueB], true);

    // Delete issueB's ward_issue row — its selections cascade-delete too.
    await db.delete(schema.wardIssues).where(eq(schema.wardIssues.id, issueB));

    const results = await issueResults(WARD_ID);
    expect(results.map((r) => r.issueId)).toEqual([issueA]);
    expect(results[0]!.sharePct).toBe(100);
    expect(results[0]!.rank).toBe(1);
  });

  // Nested (not a sibling top-level describe) so it shares this file's
  // beforeAll (migrate + seed wards)/afterAll (client.end())/beforeEach
  // (resetFixtures) — a sibling describe's afterAll would close the shared
  // pg client before these tests ran.
  describe('castVoteSet (src/lib/votes.ts) — PRD §5.5', () => {
    it('1-3 valid ids: creates an active set + selections', async () => {
      const issueA = await makeIssue('Roads', 0);
      const issueB = await makeIssue('Water', 1);
      const user = await makeUser('votes-fixture-a@example.com');

      await castVoteSet(user, WARD_ID, [issueA, issueB]);

      expect(await activeSelections(user)).toEqual([issueA, issueB].sort((a, b) => a - b));
      const sets = await db.select().from(schema.issueVoteSets).where(eq(schema.issueVoteSets.userId, user));
      expect(sets).toHaveLength(1);
      expect(sets[0]!.active).toBe(true);
    });

    it('dedupes repeated issue ids (no double-count toward the cap of 3)', async () => {
      const issueA = await makeIssue('Roads', 0);
      const issueB = await makeIssue('Water', 1);
      const issueC = await makeIssue('Waste', 2);
      const user = await makeUser('votes-fixture-a@example.com');

      // 4 raw entries, but only 3 distinct ids — must NOT throw invalid_selection_count.
      await castVoteSet(user, WARD_ID, [issueA, issueA, issueB, issueC]);

      expect(await activeSelections(user)).toEqual([issueA, issueB, issueC].sort((a, b) => a - b));
    });

    it('0 selections -> throws invalid_selection_count, writes nothing', async () => {
      const user = await makeUser('votes-fixture-a@example.com');

      await expect(castVoteSet(user, WARD_ID, [])).rejects.toThrow('invalid_selection_count');
      expect(await activeSelections(user)).toEqual([]);
    });

    it('4 selections -> throws invalid_selection_count, writes nothing', async () => {
      const issueA = await makeIssue('Roads', 0);
      const issueB = await makeIssue('Water', 1);
      const issueC = await makeIssue('Waste', 2);
      const issueD = await makeIssue('Lighting', 3);
      const user = await makeUser('votes-fixture-a@example.com');

      await expect(castVoteSet(user, WARD_ID, [issueA, issueB, issueC, issueD])).rejects.toThrow(
        'invalid_selection_count',
      );
      expect(await activeSelections(user)).toEqual([]);
    });

    it('an issue not belonging to wardId -> throws issue_not_in_ward, writes nothing', async () => {
      const issueA = await makeIssue('Roads', 0);
      const [otherIssue] = await db
        .insert(schema.wardIssues)
        .values({ wardId: OTHER_WARD_ID, titleEn: 'Other ward issue', titleKn: 'Other ward issue (kn)', position: 0 })
        .returning({ id: schema.wardIssues.id });
      const user = await makeUser('votes-fixture-a@example.com');

      await expect(castVoteSet(user, WARD_ID, [issueA, otherIssue!.id])).rejects.toThrow('issue_not_in_ward');
      expect(await activeSelections(user)).toEqual([]);
    });

    it("homeWardId !== wardId -> throws wrong_ward, writes nothing", async () => {
      const issueA = await makeIssue('Roads', 0);
      const user = await makeUser('votes-fixture-a@example.com', OTHER_WARD_ID);

      await expect(castVoteSet(user, WARD_ID, [issueA])).rejects.toThrow('wrong_ward');
      expect(await activeSelections(user)).toEqual([]);
    });

    it('RE-CAST REPLACES: casting a new set retires the old one — exactly ONE active set survives, results reflect only the new set', async () => {
      const issueA = await makeIssue('Roads', 0);
      const issueB = await makeIssue('Water', 1);
      const issueC = await makeIssue('Waste', 2);
      const user = await makeUser('votes-fixture-a@example.com');

      await castVoteSet(user, WARD_ID, [issueA, issueB]);
      await castVoteSet(user, WARD_ID, [issueC]);

      expect(await activeSelections(user)).toEqual([issueC]);

      const allSets = await db
        .select()
        .from(schema.issueVoteSets)
        .where(eq(schema.issueVoteSets.userId, user));
      expect(allSets).toHaveLength(2); // the original + the re-cast
      const activeCount = allSets.filter((s) => s.active).length;
      expect(activeCount).toBe(1); // exactly one active set, ever

      const results = await issueResults(WARD_ID);
      const byId = new Map(results.map((r) => [r.issueId, r]));
      expect(byId.get(issueC)!.sharePct).toBe(100); // only the re-cast set counts
      expect(byId.get(issueA)!.sharePct).toBe(0);
      expect(byId.get(issueB)!.sharePct).toBe(0);
    });

    it('deleting a selected ward_issue cascades its selection away; the REMAINING selections stand', async () => {
      const issueA = await makeIssue('Roads', 0);
      const issueB = await makeIssue('Water', 1);
      const user = await makeUser('votes-fixture-a@example.com');

      await castVoteSet(user, WARD_ID, [issueA, issueB]);

      await db.delete(schema.wardIssues).where(eq(schema.wardIssues.id, issueB));

      // The FK's onDelete: 'cascade' removed issueB's selection row; issueA's
      // stands untouched (PRD §5.5 "remaining selections stand").
      expect(await activeSelections(user)).toEqual([issueA]);

      const results = await issueResults(WARD_ID);
      expect(results.map((r) => r.issueId)).toEqual([issueA]);
      expect(results[0]!.sharePct).toBe(100);
    });

    it('NO AUDIT: casting a vote writes zero audit_log rows (a citizen\'s issue picks are never in the admin-readable audit trail)', async () => {
      const issueA = await makeIssue('Roads', 0);
      const issueB = await makeIssue('Water', 1);
      const user = await makeUser('votes-fixture-a@example.com');

      const before = await auditRowCount();
      await castVoteSet(user, WARD_ID, [issueA]);
      // Re-cast too — retireActiveSet's own path must also stay un-audited.
      await castVoteSet(user, WARD_ID, [issueB]);
      const after = await auditRowCount();

      expect(after).toBe(before);
    });
  });
});
