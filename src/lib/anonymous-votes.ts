import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { isUniqueViolation } from './db-errors';
import {
  anonymousIssueVoteSelections,
  anonymousIssueVoteSets,
  wardIssues,
  wards,
} from '../db/schema';

export const ANONYMOUS_VOTE_COOKIE = 'bv_issue_vote';
export const ANONYMOUS_VOTE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type AnonymousVoteStatus =
  | { status: 'not_voted' }
  | { status: 'voted_here' }
  | { status: 'voted_elsewhere'; wardId: number; wardNameEn: string; wardNameKn: string };

export type AnonymousIssueResult = {
  issueId: number;
  titleEn: string | null;
  titleKn: string | null;
  count: number;
  sharePct: number;
};

export type AnonymousVoteErrorCode = 'invalid_selection_count' | 'issue_not_in_ward' | 'already_voted';

export function newAnonymousVoteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashAnonymousVoteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function anonymousVoteStatus(token: string | undefined, wardId: number): Promise<AnonymousVoteStatus> {
  if (!token) return { status: 'not_voted' };
  const [vote] = await db
    .select({ wardId: anonymousIssueVoteSets.wardId, wardNameEn: wards.nameEn, wardNameKn: wards.nameKn })
    .from(anonymousIssueVoteSets)
    .innerJoin(wards, eq(anonymousIssueVoteSets.wardId, wards.id))
    .where(eq(anonymousIssueVoteSets.voterHash, hashAnonymousVoteToken(token)));
  if (!vote) return { status: 'not_voted' };
  return vote.wardId === wardId ? { status: 'voted_here' } : { status: 'voted_elsewhere', ...vote };
}

export async function castAnonymousVote(token: string, wardId: number, issueIds: number[]): Promise<void> {
  const uniqueIds = [...new Set(issueIds)];
  if (uniqueIds.length !== 3 || uniqueIds.length !== issueIds.length) {
    throw new Error('invalid_selection_count' satisfies AnonymousVoteErrorCode);
  }

  const valid = await db.select({ id: wardIssues.id }).from(wardIssues).where(and(
    eq(wardIssues.wardId, wardId),
    sql`${wardIssues.catalogKey} is not null`,
    inArray(wardIssues.id, uniqueIds),
  ));
  if (valid.length !== 3) throw new Error('issue_not_in_ward' satisfies AnonymousVoteErrorCode);

  try {
    await db.transaction(async (tx) => {
      const [set] = await tx.insert(anonymousIssueVoteSets).values({
        voterHash: hashAnonymousVoteToken(token),
        wardId,
      }).returning({ id: anonymousIssueVoteSets.id });
      await tx.insert(anonymousIssueVoteSelections).values(
        uniqueIds.map((wardIssueId) => ({ setId: set!.id, wardIssueId })),
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('already_voted' satisfies AnonymousVoteErrorCode);
    throw error;
  }
}

/** Percentage is the share of ward ballots that selected an issue; top-3 shares may sum to 300%. */
export async function anonymousIssueResults(wardId: number): Promise<AnonymousIssueResult[]> {
  const issues = await db.select({
    issueId: wardIssues.id,
    titleEn: wardIssues.titleEn,
    titleKn: wardIssues.titleKn,
    position: wardIssues.position,
  }).from(wardIssues).where(and(eq(wardIssues.wardId, wardId), sql`${wardIssues.catalogKey} is not null`));

  const counts = await db.select({
    issueId: anonymousIssueVoteSelections.wardIssueId,
    count: sql<number>`count(*)::int`,
  }).from(anonymousIssueVoteSelections)
    .innerJoin(anonymousIssueVoteSets, eq(anonymousIssueVoteSelections.setId, anonymousIssueVoteSets.id))
    .where(eq(anonymousIssueVoteSets.wardId, wardId))
    .groupBy(anonymousIssueVoteSelections.wardIssueId);
  const [totalRow] = await db.select({ count: sql<number>`count(*)::int` })
    .from(anonymousIssueVoteSets).where(eq(anonymousIssueVoteSets.wardId, wardId));
  const total = totalRow?.count ?? 0;
  const byIssue = new Map(counts.map((row) => [row.issueId, row.count]));

  return issues.map((issue) => {
    const count = byIssue.get(issue.issueId) ?? 0;
    return { ...issue, count, sharePct: total ? Math.round(count / total * 1000) / 10 : 0 };
  }).sort((a, b) => b.count - a.count || a.position - b.position || a.issueId - b.issueId)
    .map(({ position: _position, ...result }) => result);
}
