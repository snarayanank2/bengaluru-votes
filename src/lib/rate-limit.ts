/**
 * Per-account contribution rate limiting (dormant, no caller — architecture §15; registration-gating
 * gives every flag/vote an identity, enabling dedup + rate-limit
 * "rate-limiting on all contribution actions"; architecture §3 — no Redis,
 * Postgres-backed).
 *
 * Design: there is no separate counter table. Each limited action already
 * writes a row carrying `userId`/`createdBy` + `createdAt` (flag_submissions,
 * issue_vote_sets, media), so the limit is enforced by COUNTing the user's
 * own rows created within a trailing time window ("sliding window" — not a
 * fixed calendar-day bucket). This mirrors the shape of `consumeBudget` in
 * `src/lib/budgets.ts` but counts existing rows rather than maintaining an
 * upserted counter, because the underlying writes are the thing being
 * limited (there's nothing else to increment).
 *
 * `eoi` (expression-of-interest submissions) is anonymous — `eoi_submissions`
 * has no `userId` column — so it cannot be checked per-account. It's kept in
 * the `RateLimitAction` union for type completeness / call-site symmetry;
 * calling `checkAccountLimit` with it throws. Real EOI abuse protection is
 * reCAPTCHA (Task 50), not this module.
 *
 * Callers (Tasks 31 flags, 33 votes, 35 media upload) call
 * `checkDefaultLimit` before performing their write and return a 429-ish
 * response when it resolves to `false`.
 */
import { and, count, eq, gte } from 'drizzle-orm';
import { db } from '../db/client';
import { flagSubmissions, issueVoteSets, media } from '../db/schema';

export type RateLimitAction = 'flag' | 'vote' | 'upload' | 'eoi';

export interface RateLimit {
  count: number;
  perHours: number;
}

/** Plan's per-account limits: flags 10/day, vote re-casts 20/day, uploads 30/day. */
export const DEFAULT_LIMITS: Record<'flag' | 'vote' | 'upload', RateLimit> = {
  flag: { count: 10, perHours: 24 },
  vote: { count: 20, perHours: 24 },
  upload: { count: 30, perHours: 24 },
};

/**
 * Returns `true` when `userId` is UNDER `limit` for `action` — i.e. still
 * allowed to proceed — and `false` when they are at or over it.
 *
 * Counts rows the user created within the trailing `limit.perHours` hours
 * (a sliding window ending "now", not a calendar bucket) in the table for
 * `action`:
 *  - 'flag'   → flag_submissions.userId
 *  - 'vote'   → issue_vote_sets.userId (counts vote-set creations, i.e.
 *               each re-cast, not individual issue selections)
 *  - 'upload' → media.createdBy
 *
 * Allowed iff `count < limit.count` — so seeding exactly `limit.count` rows
 * in the window is already AT the limit and returns `false`.
 *
 * Throws for 'eoi': eoi_submissions is anonymous (no userId), so it cannot
 * be rate-limited per-account. Kept in `RateLimitAction` only for type
 * completeness at call sites; real EOI protection is reCAPTCHA (Task 50).
 */
export async function checkAccountLimit(
  userId: number,
  action: RateLimitAction,
  limit: RateLimit,
): Promise<boolean> {
  const since = new Date(Date.now() - limit.perHours * 3600_000);
  const used = await countRows(action, userId, since);
  return used < limit.count;
}

/** Row count for `action` by `userId` created since `since`. One query per table — kept separate rather than a shared generic helper because each table's user/timestamp columns have distinct Drizzle types. */
async function countRows(action: RateLimitAction, userId: number, since: Date): Promise<number> {
  switch (action) {
    case 'flag': {
      const [row] = await db
        .select({ n: count() })
        .from(flagSubmissions)
        .where(and(eq(flagSubmissions.userId, userId), gte(flagSubmissions.createdAt, since)));
      return row?.n ?? 0;
    }
    case 'vote': {
      const [row] = await db
        .select({ n: count() })
        .from(issueVoteSets)
        .where(and(eq(issueVoteSets.userId, userId), gte(issueVoteSets.createdAt, since)));
      return row?.n ?? 0;
    }
    case 'upload': {
      const [row] = await db
        .select({ n: count() })
        .from(media)
        .where(and(eq(media.createdBy, userId), gte(media.createdAt, since)));
      return row?.n ?? 0;
    }
    case 'eoi':
      throw new Error(
        'eoi is not per-account rate-limited (eoi_submissions is anonymous — use CAPTCHA, Task 50)',
      );
    default: {
      const exhaustive: never = action;
      throw new Error(`checkAccountLimit: unknown action ${exhaustive as string}`);
    }
  }
}

/** Convenience wrapper using {@link DEFAULT_LIMITS}. */
export async function checkDefaultLimit(
  userId: number,
  action: 'flag' | 'vote' | 'upload',
): Promise<boolean> {
  return checkAccountLimit(userId, action, DEFAULT_LIMITS[action]);
}
