/**
 * Issue-vote results (PRD §5.5, §13.1 Phase 1; IA §3.6). This file is the
 * READ side only (Task 20) — the ward issues page's public results and, in
 * time, the `/data` city-wide roll-up both read through `issueResults`.
 * Task 33 EXTENDS this module with the write path (casting/replacing a
 * vote-set) — do not restructure the read query's shape without checking
 * that task's needs too.
 *
 * Share definition (PRD §5.5 "percentage shares", chosen interpretation):
 * each current ward issue's `sharePct` is that issue's selection count as a
 * percentage of the TOTAL selections cast across all of the ward's current
 * issues — i.e. "what share of all top-3 picks went to this issue", not
 * "what share of voters picked this issue" (a voter can contribute to more
 * than one issue's count by selecting up to three). This matches "ranked
 * order with percentage shares" as the simplest, most directly plottable
 * reading, and is what `<IssueBars>` renders as a set of bars each summing
 * toward the same 100%.
 *
 * Retired-set exclusion (core privacy/correctness rule, PRD §5.5): only
 * `issue_vote_sets.active = true` rows count. A citizen who changes home
 * ward, or re-casts their top-3, leaves behind an inactive set that must
 * never contribute to any ward's public aggregate again — the join below
 * filters on `active` before counting anything.
 *
 * Current-issue-list scoping (PRD §5.5 "deleting an issue removes it from
 * every vote-set... results are always computed against the current
 * list"): the query starts from `ward_issues` for this ward and only looks
 * up a count for each issue found there. A selection row whose issue was
 * since deleted is already gone via the FK's `onDelete: 'cascade'`
 * (schema.ts), and a stray selection that doesn't match any current issue
 * id is simply never consulted — there is nothing to filter out
 * defensively.
 *
 * No-raw-counts guarantee (PRD §5.5 "no raw counts on this page"): counts
 * are computed internally to derive rank/share but are NEVER placed on the
 * returned objects — the return type has no `count` field. `/data`'s
 * later, separate total-votes figure is out of scope for this function.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Db, type Tx } from '../db/client';
import { wardIssues, issueVoteSets, issueVoteSelections, users } from '../db/schema';
import { isUniqueViolation } from './db-errors';

export interface IssueResult {
  issueId: number;
  titleEn: string | null;
  titleKn: string | null;
  rank: number;
  sharePct: number;
}

/** Rounds to one decimal place — enough precision for a percentage share. */
function roundShare(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

export async function issueResults(wardId: number): Promise<IssueResult[]> {
  const issues = await db
    .select({
      id: wardIssues.id,
      titleEn: wardIssues.titleEn,
      titleKn: wardIssues.titleKn,
      position: wardIssues.position,
    })
    .from(wardIssues)
    .where(eq(wardIssues.wardId, wardId));

  if (issues.length === 0) return [];

  // Selection counts, ACTIVE vote-sets only, for this ward — grouped by the
  // ward_issue they reference. Issues with no rows here simply get 0 below.
  const counted = await db
    .select({
      wardIssueId: issueVoteSelections.wardIssueId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(issueVoteSelections)
    .innerJoin(issueVoteSets, eq(issueVoteSelections.setId, issueVoteSets.id))
    .where(and(eq(issueVoteSets.wardId, wardId), eq(issueVoteSets.active, true)))
    .groupBy(issueVoteSelections.wardIssueId);

  const countByIssueId = new Map<number, number>();
  for (const row of counted) countByIssueId.set(row.wardIssueId, row.count);

  const withCounts = issues.map((issue) => ({
    issueId: issue.id,
    titleEn: issue.titleEn,
    titleKn: issue.titleKn,
    position: issue.position,
    count: countByIssueId.get(issue.id) ?? 0,
  }));

  const total = withCounts.reduce((sum, issue) => sum + issue.count, 0);

  // Descending by count; ties broken by curator position, then id, so the
  // zero-selections case (total === 0) falls back to position order
  // deterministically (every count is 0, so every comparison ties through
  // to position/id).
  withCounts.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.position !== b.position) return a.position - b.position;
    return a.issueId - b.issueId;
  });

  return withCounts.map((issue, index) => ({
    issueId: issue.issueId,
    titleEn: issue.titleEn,
    titleKn: issue.titleKn,
    rank: index + 1,
    sharePct: roundShare(issue.count, total),
  }));
}

/**
 * Retires `userId`'s ACTIVE issue-vote-set, if any (a no-op otherwise —
 * `schema.ts`'s `active_set_uq` guarantees at most one). Called whenever a
 * citizen changes their home ward (PRD §5.5: "changing home ward retires
 * the previous ward's vote-set" — Task 29, `src/lib/account-flow.ts`) and,
 * per Task 33, whenever they re-cast a fresh top-3 in their current ward.
 *
 * Accepts an optional `executor` (a `db.transaction()` callback's `tx`
 * handle) so a caller that must update `users.homeWardId` and retire the
 * vote-set atomically can pass its own `tx` through — e.g.
 * `db.transaction(async (tx) => { await tx.update(users)...; await
 * retireActiveSet(userId, tx); })`. Defaults to the module-level `db` for
 * every other (non-transactional) call site.
 *
 */
export async function retireActiveSet(userId: number, executor: Db | Tx = db): Promise<void> {
  await executor
    .update(issueVoteSets)
    .set({ active: false })
    .where(and(eq(issueVoteSets.userId, userId), eq(issueVoteSets.active, true)));
}

/** Thrown by {@link castVoteSet}; `.message` is the stable error code the caller (src/pages/api/issue-votes.ts) matches against to pick an HTTP status — same plain-`Error`-with-a-code-message convention as src/lib/flags.ts's `flag_already_resolved`. */
export type CastVoteErrorCode = 'invalid_selection_count' | 'issue_not_in_ward' | 'wrong_ward';

const MAX_CAST_ATTEMPTS = 3;

/** Retires `userId`'s active set (if any) and inserts a brand-new active one with `issueIds`' selections, all inside `tx`. Factored out so {@link castVoteSet}'s retry loop can re-run exactly this on a unique-violation race (see that function's docstring). */
async function retireAndInsertSet(tx: Tx, userId: number, wardId: number, issueIds: number[]): Promise<void> {
  await retireActiveSet(userId, tx);

  const [set] = await tx
    .insert(issueVoteSets)
    .values({ userId, wardId, active: true })
    .returning({ id: issueVoteSets.id });

  for (const wardIssueId of issueIds) {
    await tx.insert(issueVoteSelections).values({ setId: set!.id, wardIssueId });
  }
}

/**
 * Casts (or re-casts) `userId`'s top-3 issue vote-set for `wardId` (PRD
 * §5.5). Validates, then RE-CAST-REPLACES atomically: any existing active
 * set is retired and a brand-new one (with exactly `issueIds`' selections)
 * takes its place — a citizen never has more than one active set at a time
 * (schema.ts's `active_set_uq` is the DB-level backstop for this).
 *
 * VALIDATION (in this order; every failure throws a plain `Error` whose
 * `.message` is one of {@link CastVoteErrorCode}, before anything is
 * written):
 *   1. `issueIds` is deduped (a citizen double-clicking/double-posting the
 *      same issue id must not double-count it as 2 of their 3 picks), then
 *      checked for length 1..3 -> `invalid_selection_count`. Zero
 *      selections is rejected here too — "clearing" a vote isn't a
 *      supported action (PRD §5.5 only describes casting/re-casting).
 *   2. `userId`'s CURRENT `homeWardId` must equal `wardId` ->
 *      `wrong_ward`. Voting is home-ward-only (PRD §5.5) and is always
 *      checked against the live `users` row, never a value the caller
 *      merely asserts.
 *   3. Every deduped id must be a `ward_issues` row belonging to `wardId`
 *      -> `issue_not_in_ward` (defends against a stale client holding an
 *      issue id that's since been deleted, or one belonging to a different
 *      ward entirely).
 *
 * CONCURRENCY: the retire + insert happen in ONE transaction
 * ({@link retireAndInsertSet}). For a citizen who already has an active
 * set, the retiring `UPDATE ... WHERE active` takes a row lock that
 * naturally serializes a second concurrent cast behind the first (the
 * second transaction's UPDATE blocks, then — under READ COMMITTED — finds
 * the row no longer matches `active = true` once unblocked, so its own
 * INSERT never collides with the unique index). The one race this can't
 * serialize away is a citizen's very FIRST-EVER vote in this ward, cast
 * twice at the same instant from two requests: the retiring UPDATE matches
 * zero rows in both (there is nothing to lock yet), so both proceed to
 * INSERT and the `active_set_uq` partial unique index lets exactly one
 * through, 23505-ing the other. Rather than surface that as a bare 500,
 * this retries the WHOLE transaction (bounded, {@link MAX_CAST_ATTEMPTS}
 * attempts): by the retry, the other request's row is committed, so this
 * attempt's retiring UPDATE now finds and properly retires it before
 * inserting its own — same "re-cast replaces" outcome, just resolved a
 * beat later. (Documented per the task brief's explicit "acceptable to
 * fail the second OR retry" — this implementation retries.)
 */
export async function castVoteSet(userId: number, wardId: number, issueIds: number[]): Promise<void> {
  const dedupedIds = Array.from(new Set(issueIds));
  if (dedupedIds.length < 1 || dedupedIds.length > 3) {
    throw new Error('invalid_selection_count' satisfies CastVoteErrorCode);
  }

  const [user] = await db.select({ homeWardId: users.homeWardId }).from(users).where(eq(users.id, userId));
  if (!user || user.homeWardId !== wardId) {
    throw new Error('wrong_ward' satisfies CastVoteErrorCode);
  }

  const validIssues = await db
    .select({ id: wardIssues.id })
    .from(wardIssues)
    .where(and(eq(wardIssues.wardId, wardId), inArray(wardIssues.id, dedupedIds)));
  if (validIssues.length !== dedupedIds.length) {
    throw new Error('issue_not_in_ward' satisfies CastVoteErrorCode);
  }

  for (let attempt = 1; attempt <= MAX_CAST_ATTEMPTS; attempt++) {
    try {
      await db.transaction((tx) => retireAndInsertSet(tx, userId, wardId, dedupedIds));
      return;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_CAST_ATTEMPTS) continue; // see docstring's CONCURRENCY note
      throw err;
    }
  }
}
