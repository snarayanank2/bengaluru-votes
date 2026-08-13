/**
 * Task 51 — src/lib/metrics.ts: `publicMetrics()`, the figures `/data` and
 * `/press` publish (PRD §5.14; IA §3.14).
 *
 * SHARED-DB CAVEAT (same as tests/unit/partners.test.ts's `partnerCoverage`
 * suite): every figure here is a GLOBAL aggregate over the WHOLE database,
 * not scoped to this file's own fixtures, and this test DB is shared
 * across every test file in one run (vitest.config.ts: `fileParallelism:
 * false`, one Postgres instance, never truncated between files). Two
 * strategies keep assertions deterministic despite that:
 *
 *   1. DELTA assertions for every additive count (registeredCitizens,
 *      flagsRaised, flagsResolved, wardsWithData, wardsSignedOff,
 *      reportCardsComplete, activeCurators, sourcesCited, total,
 *      totalVotesCast): snapshot `publicMetrics()` BEFORE inserting this
 *      suite's fixtures and again AFTER, and assert the DIFFERENCE equals
 *      this suite's own known contribution. This is correct regardless of
 *      whatever pre-existing rows other test files left behind.
 *   2. UNIQUE TEXT for the one non-additive figure, `issueRollup`'s
 *      per-issue counts: this suite's ward-issue titles ("Metrics Rollup
 *      …") are globally unique strings, so — since the roll-up groups by
 *      normalized title text, not ward id — no other test file's fixture
 *      data can contribute to (or dilute) these specific entries.
 *      `medianResolveHours` (also non-additive) is instead checked by
 *      independently re-deriving the expected median from a fresh direct
 *      query of every currently-resolved `flag_items` row (ground truth),
 *      and a fully isolated null/rounding check against the exported pure
 *      `computeMedianHours` helper (no DB at all).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, inArray, isNotNull } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { publicMetrics, computeMedianHours, type Metrics } from '../../src/lib/metrics';
// Reuses the SHARED module-level pool (src/db/client.ts) rather than opening
// a dedicated connection of its own. The test Postgres instance's
// connection ceiling is already close to fully subscribed by the ~50
// existing test files that each open one (see the task-51 report) — this
// file's own fixture inserts/deletes/queries work identically against the
// shared pool, so there is no need to add a 51st. Never call `.end()` on
// this shared client — every other test file still needs it.
import { db } from '../../src/db/client';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

// Fresh, task-51-owned ward id block (99930-99937) — clear of every other
// suite's fixtures (the highest id in use elsewhere at authoring time was
// 99920-ish; see the task-51 report for the actual scan).
const WARD_A = { id: 99930, nameEn: 'Metrics Test Ward A', nameKn: 'ಮೆಟ್ರಿಕ್ಸ್ ಎ', corporation: 'south' as const, zone: 'Zone M', boundaryRef: 'metrics-test-ward-a' };
const WARD_B = { id: 99931, nameEn: 'Metrics Test Ward B', nameKn: 'ಮೆಟ್ರಿಕ್ಸ್ ಬಿ', corporation: 'south' as const, zone: 'Zone M', boundaryRef: 'metrics-test-ward-b' };
const WARD_C = { id: 99932, nameEn: 'Metrics Test Ward C', nameKn: 'ಮೆಟ್ರಿಕ್ಸ್ ಸಿ', corporation: 'south' as const, zone: 'Zone M', boundaryRef: 'metrics-test-ward-c' };
const WARD_D = { id: 99933, nameEn: 'Metrics Test Ward D', nameKn: 'ಮೆಟ್ರಿಕ್ಸ್ ಡಿ', corporation: 'south' as const, zone: 'Zone M', boundaryRef: 'metrics-test-ward-d' };
const WARD_E = { id: 99934, nameEn: 'Metrics Test Ward E', nameKn: 'ಮೆಟ್ರಿಕ್ಸ್ ಇ', corporation: 'south' as const, zone: 'Zone M', boundaryRef: 'metrics-test-ward-e' };
const WARD_F = { id: 99935, nameEn: 'Metrics Test Ward F', nameKn: 'ಮೆಟ್ರಿಕ್ಸ್ ಎಫ್', corporation: 'south' as const, zone: 'Zone M', boundaryRef: 'metrics-test-ward-f' };
const WARD_G = { id: 99936, nameEn: 'Metrics Test Ward G', nameKn: 'ಮೆಟ್ರಿಕ್ಸ್ ಜಿ', corporation: 'south' as const, zone: 'Zone M', boundaryRef: 'metrics-test-ward-g' };
const WARD_H = { id: 99937, nameEn: 'Metrics Test Ward H', nameKn: 'ಮೆಟ್ರಿಕ್ಸ್ ಎಚ್', corporation: 'south' as const, zone: 'Zone M', boundaryRef: 'metrics-test-ward-h' };
const ALL_WARDS = [WARD_A, WARD_B, WARD_C, WARD_D, WARD_E, WARD_F, WARD_G, WARD_H];
const ALL_WARD_IDS = ALL_WARDS.map((w) => w.id);

const EMAILS = {
  citizen1: 'metrics-fixture-citizen1@example.com',
  citizen2: 'metrics-fixture-citizen2@example.com',
  curatorActive: 'metrics-fixture-curator-active@example.com',
  curatorBanned: 'metrics-fixture-curator-banned@example.com',
  admin: 'metrics-fixture-admin@example.com',
};

const FLAG_REFS = {
  pending: 'metrics-test:flag-pending',
  resolvedAccepted: 'metrics-test:flag-resolved-accepted',
  resolvedRejected: 'metrics-test:flag-resolved-rejected',
};

const ISSUE_TITLES = {
  roads: 'Metrics Rollup Roads',
  water: 'Metrics Rollup Water',
  retiredOnly: 'Metrics Rollup Retired-Only',
};

let before: Metrics;
let after: Metrics;

async function cleanupFixtures(): Promise<void> {
  const issueRows = await db.select({ id: schema.wardIssues.id }).from(schema.wardIssues).where(inArray(schema.wardIssues.wardId, ALL_WARD_IDS));
  const issueIds = issueRows.map((r) => r.id);
  if (issueIds.length > 0) {
    await db.delete(schema.issueVoteSelections).where(inArray(schema.issueVoteSelections.wardIssueId, issueIds));
  }
  const setRows = await db.select({ id: schema.issueVoteSets.id }).from(schema.issueVoteSets).where(inArray(schema.issueVoteSets.wardId, ALL_WARD_IDS));
  const setIds = setRows.map((r) => r.id);
  if (setIds.length > 0) {
    await db.delete(schema.issueVoteSelections).where(inArray(schema.issueVoteSelections.setId, setIds));
  }
  await db.delete(schema.issueVoteSets).where(inArray(schema.issueVoteSets.wardId, ALL_WARD_IDS));
  await db.delete(schema.wardIssues).where(inArray(schema.wardIssues.wardId, ALL_WARD_IDS));

  const flagItemIds = await db
    .select({ id: schema.flagItems.id })
    .from(schema.flagItems)
    .where(inArray(schema.flagItems.targetRef, Object.values(FLAG_REFS)));
  const ids = flagItemIds.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(schema.flagSubmissions).where(inArray(schema.flagSubmissions.flagItemId, ids));
    await db.delete(schema.flagItems).where(inArray(schema.flagItems.id, ids));
  }

  const candidateRows = await db.select({ id: schema.candidates.id }).from(schema.candidates).where(inArray(schema.candidates.wardId, ALL_WARD_IDS));
  const candidateIds = candidateRows.map((r) => r.id);
  if (candidateIds.length > 0) {
    await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
  }
  await db.delete(schema.candidates).where(inArray(schema.candidates.wardId, ALL_WARD_IDS));

  await db.delete(schema.wardReadiness).where(inArray(schema.wardReadiness.wardId, ALL_WARD_IDS));
  await db.delete(schema.users).where(inArray(schema.users.email, Object.values(EMAILS)));
  await db.delete(schema.wards).where(inArray(schema.wards.id, ALL_WARD_IDS));
}

async function insertCandidate(
  wardId: number,
  overrides: Partial<typeof schema.candidates.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(schema.candidates)
    .values({
      slug: `metrics-test-${wardId}-${Math.random().toString(36).slice(2)}`,
      wardId,
      nameEn: 'Metrics Test Candidate',
      partyEn: 'Independent',
      status: 'filed',
      ...overrides,
    })
    .returning({ id: schema.candidates.id });
  return row!.id;
}

async function insertField(
  candidateId: number,
  fieldKey: string,
  overrides: Partial<typeof schema.candidateFields.$inferInsert> = {},
): Promise<void> {
  await db.insert(schema.candidateFields).values({
    candidateId,
    fieldKey,
    sourceType: 'curator',
    ...overrides,
  });
}

async function insertUser(email: string, role: 'citizen' | 'curator' | 'admin', status: 'active' | 'banned' = 'active'): Promise<number> {
  const [row] = await db.insert(schema.users).values({ email, role, status }).returning({ id: schema.users.id });
  return row!.id;
}

describe('publicMetrics (src/lib/metrics.ts) — PRD §5.14, IA §3.14', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await cleanupFixtures();

    // Snapshot BEFORE this suite's fixtures exist (including the wards
    // themselves) — every delta assertion below is (after - before), immune
    // to whatever else is in the shared test DB (see the module docstring
    // above).
    before = await publicMetrics();

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward);
    }

    // ---- coverage fixtures ---------------------------------------------
    // WARD_A: one 'filed' candidate, name+party set, all three report-card
    // fields present + sourced (education via notDeclared) -> a COMPLETE
    // report card. Counts toward wardsWithData AND reportCardsComplete.
    // sourcesCited += 3.
    const candA1 = await insertCandidate(WARD_A.id, { status: 'filed', nameEn: 'Metrics A1', partyEn: 'Party A' });
    await insertField(candA1, 'cases', { valueEn: 'No pending cases.', sourceUrl: 'https://example.com/a1-cases' });
    await insertField(candA1, 'assets', { valueEn: 'Rs. 5 lakh.', sourceUrl: 'https://example.com/a1-assets' });
    await insertField(candA1, 'education', { notDeclared: true, sourceUrl: 'https://example.com/a1-education' });

    // WARD_B: one 'contesting' candidate with SOME fields, but incomplete
    // (assets has no source; education missing entirely) -> counts toward
    // wardsWithData (has >=1 fields row) but NOT reportCardsComplete.
    // sourcesCited += 1 (only 'cases' is sourced).
    const candB1 = await insertCandidate(WARD_B.id, { status: 'contesting', nameEn: 'Metrics B1', partyEn: 'Party B' });
    await insertField(candB1, 'cases', { valueEn: 'No pending cases.', sourceUrl: 'https://example.com/b1-cases' });
    await insertField(candB1, 'assets', { valueEn: 'Rs. 2 lakh.', sourceUrl: null });

    // WARD_C: one 'filed' candidate, ZERO candidate_fields rows at all ->
    // must NOT count toward wardsWithData (no published field data yet).
    await insertCandidate(WARD_C.id, { status: 'filed', nameEn: 'Metrics C1', partyEn: 'Party C' });

    // WARD_D: one WITHDRAWN candidate with a fully sourced, complete field
    // set -> must NOT count toward wardsWithData/reportCardsComplete
    // (withdrawn is excluded from both — PRD §5.2/§9.1), but its sourced
    // fields DO still count toward sourcesCited (the spec's `sourcesCited`
    // is not scoped to active candidates: a withdrawn candidate's
    // already-published, sourced fields are still shown, PRD §5.2).
    // sourcesCited += 3.
    const candD1 = await insertCandidate(WARD_D.id, { status: 'withdrawn', nameEn: 'Metrics D1', partyEn: 'Party D' });
    await insertField(candD1, 'cases', { valueEn: 'No pending cases.', sourceUrl: 'https://example.com/d1-cases' });
    await insertField(candD1, 'assets', { valueEn: 'Rs. 1 lakh.', sourceUrl: 'https://example.com/d1-assets' });
    await insertField(candD1, 'education', { valueEn: 'B.A.', sourceUrl: 'https://example.com/d1-education' });

    // WARD_E: signed off, never cleared -> counts wardsSignedOff.
    const now = new Date();
    await db.insert(schema.wardReadiness).values({ wardId: WARD_E.id, signedOffAt: now, clearedAt: null });

    // WARD_F: signed off AFTER an earlier clear (re-signed) -> "not cleared
    // SINCE the sign-off" -> still counts wardsSignedOff.
    const earlier = new Date(now.getTime() - 24 * 3_600_000);
    await db.insert(schema.wardReadiness).values({ wardId: WARD_F.id, signedOffAt: now, clearedAt: earlier });

    // WARD_G: cleared, never (re-)signed off (signedOffAt null) -> excluded
    // entirely by the `isNotNull(signedOffAt)` filter -> does NOT count.
    await db.insert(schema.wardReadiness).values({ wardId: WARD_G.id, signedOffAt: null, clearedAt: now });

    // ---- users ------------------------------------------------------------
    await insertUser(EMAILS.citizen1, 'citizen');
    await insertUser(EMAILS.citizen2, 'citizen');
    await insertUser(EMAILS.curatorActive, 'curator', 'active');
    await insertUser(EMAILS.curatorBanned, 'curator', 'banned'); // must NOT count as an active curator
    await insertUser(EMAILS.admin, 'admin'); // must NOT count as registeredCitizens or activeCurators

    const [citizen1] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, EMAILS.citizen1));
    const [citizen2] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, EMAILS.citizen2));
    const [adminUser] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, EMAILS.admin));

    // ---- flags --------------------------------------------------------
    // One PENDING item with 2 submissions -> flagsRaised += 2, flagsResolved += 0.
    const [pendingItem] = await db
      .insert(schema.flagItems)
      .values({ wardId: WARD_A.id, targetType: 'candidate_field', targetRef: FLAG_REFS.pending, status: 'pending' })
      .returning({ id: schema.flagItems.id });
    await db.insert(schema.flagSubmissions).values([
      { flagItemId: pendingItem!.id, userId: citizen1!.id, detail: 'Looks wrong.' },
      { flagItemId: pendingItem!.id, userId: citizen2!.id, detail: 'Confirming this looks wrong too.' },
    ]);

    // Two RESOLVED items (1 submission each) with KNOWN createdAt/resolvedAt
    // — resolveHours 2 and 6 — for the median check below.
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const [acceptedItem] = await db
      .insert(schema.flagItems)
      .values({
        wardId: WARD_A.id,
        targetType: 'candidate_field',
        targetRef: FLAG_REFS.resolvedAccepted,
        status: 'accepted',
        createdAt: t0,
        resolvedAt: new Date(t0.getTime() + 2 * 3_600_000),
        resolvedBy: adminUser!.id,
      })
      .returning({ id: schema.flagItems.id });
    await db.insert(schema.flagSubmissions).values({ flagItemId: acceptedItem!.id, userId: citizen1!.id, detail: 'Please fix.' });

    const [rejectedItem] = await db
      .insert(schema.flagItems)
      .values({
        wardId: WARD_A.id,
        targetType: 'candidate_field',
        targetRef: FLAG_REFS.resolvedRejected,
        status: 'rejected',
        createdAt: t0,
        resolvedAt: new Date(t0.getTime() + 6 * 3_600_000),
        resolvedBy: adminUser!.id,
        resolutionReason: 'Not an error.',
      })
      .returning({ id: schema.flagItems.id });
    await db.insert(schema.flagSubmissions).values({ flagItemId: rejectedItem!.id, userId: citizen2!.id, detail: 'This looks off.' });

    // ---- issue-vote roll-up --------------------------------------------
    // Globally-unique issue titles isolate this suite's contribution to
    // the city-wide roll-up regardless of any other test file's ward-issue
    // fixtures (see the module docstring's UNIQUE TEXT strategy).
    const [roadsIssue] = await db
      .insert(schema.wardIssues)
      .values({ wardId: WARD_H.id, titleEn: ISSUE_TITLES.roads, titleKn: `${ISSUE_TITLES.roads} (kn)`, position: 0 })
      .returning({ id: schema.wardIssues.id });
    const [waterIssue] = await db
      .insert(schema.wardIssues)
      .values({ wardId: WARD_H.id, titleEn: ISSUE_TITLES.water, titleKn: `${ISSUE_TITLES.water} (kn)`, position: 1 })
      .returning({ id: schema.wardIssues.id });
    const [retiredOnlyIssue] = await db
      .insert(schema.wardIssues)
      .values({ wardId: WARD_H.id, titleEn: ISSUE_TITLES.retiredOnly, titleKn: `${ISSUE_TITLES.retiredOnly} (kn)`, position: 2 })
      .returning({ id: schema.wardIssues.id });

    // Active set 1 (citizen1): Roads + Water.
    const [set1] = await db.insert(schema.issueVoteSets).values({ userId: citizen1!.id, wardId: WARD_H.id, active: true }).returning({ id: schema.issueVoteSets.id });
    await db.insert(schema.issueVoteSelections).values([
      { setId: set1!.id, wardIssueId: roadsIssue!.id },
      { setId: set1!.id, wardIssueId: waterIssue!.id },
    ]);

    // Active set 2 (citizen2): Roads only.
    const [set2] = await db.insert(schema.issueVoteSets).values({ userId: citizen2!.id, wardId: WARD_H.id, active: true }).returning({ id: schema.issueVoteSets.id });
    await db.insert(schema.issueVoteSelections).values({ setId: set2!.id, wardIssueId: roadsIssue!.id });

    // RETIRED set (adminUser): votes for the "retired-only" issue — must be
    // excluded from every figure entirely (active=false).
    const [retiredSet] = await db.insert(schema.issueVoteSets).values({ userId: adminUser!.id, wardId: WARD_H.id, active: false }).returning({ id: schema.issueVoteSets.id });
    await db.insert(schema.issueVoteSelections).values({ setId: retiredSet!.id, wardIssueId: retiredOnlyIssue!.id });

    after = await publicMetrics();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  describe('coverage', () => {
    it('wardsWithData: counts WARD_A + WARD_B (>=1 candidate_fields row on an active candidate); excludes WARD_C (no fields) and WARD_D (withdrawn)', () => {
      expect(after.coverage.wardsWithData - before.coverage.wardsWithData).toBe(2);
    });

    it('total: a real, live ward count (this suite added exactly 8 wards)', () => {
      expect(after.coverage.total - before.coverage.total).toBe(ALL_WARD_IDS.length);
    });

    it('wardsSignedOff: WARD_E (signed, never cleared) + WARD_F (re-signed after an earlier clear) count; WARD_G (cleared, never signed) does not', () => {
      expect(after.coverage.wardsSignedOff - before.coverage.wardsSignedOff).toBe(2);
    });

    it('reportCardsComplete: only WARD_A\'s candidate is fully complete (name+party+3 sourced fields, notDeclared counts as complete)', () => {
      expect(after.coverage.reportCardsComplete - before.coverage.reportCardsComplete).toBe(1);
    });

    it('activeCurators: counts the ACTIVE curator only — excludes the banned curator and the admin entirely', () => {
      expect(after.coverage.activeCurators - before.coverage.activeCurators).toBe(1);
    });

    it('sourcesCited: sums sourced candidate_fields rows across ALL candidates regardless of status (3 + 1 + 0 + 3 = 7, including the withdrawn candidate\'s sourced fields)', () => {
      expect(after.coverage.sourcesCited - before.coverage.sourcesCited).toBe(7);
    });
  });

  describe('integrity', () => {
    it('flagsRaised: SUM of flag_submissions (2 + 1 + 1 = 4) — NOT the count of dedup flag_items (which is 3 for this suite)', () => {
      expect(after.integrity.flagsRaised - before.integrity.flagsRaised).toBe(4);
    });

    it('flagsResolved: counts RESOLVED flag_items only (the 2 accepted/rejected items) — the pending item does not count', () => {
      expect(after.integrity.flagsResolved - before.integrity.flagsResolved).toBe(2);
    });

    it('medianResolveHours: matches an independently-derived ground truth over every currently-resolved flag_items row', async () => {
      const resolvedRows = await db
        .select({ createdAt: schema.flagItems.createdAt, resolvedAt: schema.flagItems.resolvedAt })
        .from(schema.flagItems)
        .where(isNotNull(schema.flagItems.resolvedAt));
      const hours = resolvedRows.map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 3_600_000);
      const expected = computeMedianHours(hours);

      expect(after.integrity.medianResolveHours).toBe(expected);
      // Sanity: our two known fixtures (2h, 6h) are actually IN the ground-truth set.
      expect(hours).toEqual(expect.arrayContaining([2, 6]));
    });
  });

  describe('citizenSignal', () => {
    it('totalVotesCast: sums ACTIVE selections only (2 from set1 + 1 from set2 = 3); the retired set\'s selection is excluded', () => {
      expect(after.citizenSignal.totalVotesCast - before.citizenSignal.totalVotesCast).toBe(3);
    });

    it('registeredCitizens: counts role=citizen ONLY — the curator(s) and admin fixture do not count', () => {
      expect(after.citizenSignal.registeredCitizens - before.citizenSignal.registeredCitizens).toBe(2);
    });

    it('issueRollup: ranks Roads (2 selections) above Water (1), and its sharePct is self-consistent with the reported total', () => {
      const roads = after.citizenSignal.issueRollup.find((r) => r.issueTitle === ISSUE_TITLES.roads);
      const water = after.citizenSignal.issueRollup.find((r) => r.issueTitle === ISSUE_TITLES.water);
      expect(roads).toBeDefined();
      expect(water).toBeDefined();
      expect(roads!.rank).toBeLessThan(water!.rank);

      const expectedRoadsShare = Math.round((2 / after.citizenSignal.totalVotesCast) * 1000) / 10;
      const expectedWaterShare = Math.round((1 / after.citizenSignal.totalVotesCast) * 1000) / 10;
      expect(roads!.sharePct).toBe(expectedRoadsShare);
      expect(water!.sharePct).toBe(expectedWaterShare);
    });

    it('issueRollup: a RETIRED vote-set never contributes an entry', () => {
      const retired = after.citizenSignal.issueRollup.find((r) => r.issueTitle === ISSUE_TITLES.retiredOnly);
      expect(retired).toBeUndefined();
    });
  });

  describe('asOf', () => {
    it('is a parseable, recent ISO-8601 timestamp', () => {
      const parsed = Date.parse(after.asOf);
      expect(Number.isNaN(parsed)).toBe(false);
      expect(Date.now() - parsed).toBeLessThan(60_000);
    });
  });

  describe('NO PII', () => {
    it('the returned shape carries only aggregate counts/percentages/titles — no email, phone, or other user-identifying field', () => {
      expect(Object.keys(after.coverage).sort()).toEqual(
        ['activeCurators', 'reportCardsComplete', 'sourcesCited', 'total', 'wardsSignedOff', 'wardsWithData'].sort(),
      );
      expect(Object.keys(after.integrity).sort()).toEqual(['flagsRaised', 'flagsResolved', 'medianResolveHours'].sort());
      expect(Object.keys(after.citizenSignal).sort()).toEqual(
        ['issueRollup', 'registeredCitizens', 'totalVotesCast'].sort(),
      );
      for (const item of after.citizenSignal.issueRollup) {
        expect(Object.keys(item).sort()).toEqual(['issueTitle', 'rank', 'sharePct'].sort());
      }

      const serialized = JSON.stringify(after);
      expect(serialized).not.toContain(EMAILS.citizen1);
      expect(serialized).not.toContain(EMAILS.citizen2);
      expect(serialized).not.toContain(EMAILS.admin);
    });
  });
});

describe('computeMedianHours (pure helper, no DB)', () => {
  it('returns null for an empty array (never a fabricated 0)', () => {
    expect(computeMedianHours([])).toBeNull();
  });

  it('returns the middle value for an odd-length array', () => {
    expect(computeMedianHours([1, 5, 3])).toBe(3);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(computeMedianHours([1, 2, 3, 4])).toBe(2.5);
  });

  it('rounds to one decimal place', () => {
    expect(computeMedianHours([1, 2, 3])).toBe(2);
    expect(computeMedianHours([1.111, 2.222, 3.333])).toBeCloseTo(2.2, 5);
  });
});
