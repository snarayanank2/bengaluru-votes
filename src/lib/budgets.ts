/**
 * Shared daily-budget counter (architecture.md §13 "cost amplification";
 * dependency register §6.4/§6.5 for geocoding specifically). Reused by
 * geocoding (this task), OTP sending (Task 25), and news-link suggestion
 * queries (Task 55) — one counter mechanism, one enum of kinds
 * (`budget_kind` in src/db/schema.ts), keyed by (UTC day, kind).
 *
 * Atomicity: `consumeBudget` is a single `INSERT ... ON CONFLICT DO UPDATE
 * SET count = count + 1 RETURNING count` statement. There is no
 * read-then-write gap in application code — Postgres serializes concurrent
 * upserts on the same (day, kind) row itself, so two callers racing to
 * consume the last unit of budget both get a distinct, correct post-
 * increment count back (one <= limit, the other > limit), never a lost
 * update. Do not "optimize" this into a SELECT followed by an UPDATE/INSERT
 * — that reintroduces the race this function exists to close.
 *
 * Alarm hook: the crossing from "under budget" to "exhausted" is the moment
 * `consumeBudget` returns `false` for the first time on a given
 * (day, kind) — i.e. the call where `count` first exceeds `dailyLimit`.
 * This module does not send anything on that crossing; it only reports the
 * boolean. Task 55's mailer is the intended place to notice the
 * true→false transition (e.g. by comparing against the previous call, or by
 * a periodic check via `budgetRemaining`) and fire the ops-alarm email.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { budgetCounters } from '../db/schema';

export type BudgetKind = 'geocode' | 'otp_send' | 'news_query' | 'epic_lookup' | 'anonymous_vote';

/** UTC calendar date as 'YYYY-MM-DD', matching the `date` (string-mode) column. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Atomically increment today's (UTC) counter for `kind` and report whether
 * the budget still holds. Returns `true` when the post-increment count is
 * `<= dailyLimit`; `false` the moment it would exceed `dailyLimit` (the
 * call itself still counts — the counter is incremented either way, so a
 * caller that ignores a `false` result and calls the paid API anyway would
 * under-count its own spend).
 */
export async function consumeBudget(kind: BudgetKind, dailyLimit: number): Promise<boolean> {
  const day = todayUtc();

  const [row] = await db
    .insert(budgetCounters)
    .values({ day, kind, count: 1 })
    .onConflictDoUpdate({
      target: [budgetCounters.day, budgetCounters.kind],
      set: { count: sql`${budgetCounters.count} + 1` },
    })
    .returning({ count: budgetCounters.count });

  if (!row) {
    throw new Error('consumeBudget: upsert returned no row');
  }

  return row.count <= dailyLimit;
}

/**
 * Read-only: how much of today's (UTC) budget remains for `kind`, without
 * incrementing anything. Used by ops status/alarm checks. Can be negative
 * if the budget has already been exceeded.
 */
export async function budgetRemaining(kind: BudgetKind, dailyLimit: number): Promise<number> {
  const day = todayUtc();

  const [row] = await db
    .select({ count: budgetCounters.count })
    .from(budgetCounters)
    .where(and(eq(budgetCounters.day, day), eq(budgetCounters.kind, kind)));

  const used = row?.count ?? 0;
  return dailyLimit - used;
}
