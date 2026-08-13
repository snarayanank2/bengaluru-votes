import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { consumeBudget, budgetRemaining } from '../../src/lib/budgets';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// Both buckets point at the same `kind`: with only three `budget_kind`
// enum values total, and two of them now genuinely owned by a feature that
// resets/asserts on them in its own test file (geocode.test.ts owns
// 'geocode'; tests/unit/otp.test.ts and tests/routes/otp.test.ts own
// 'otp_send', reset in their own beforeEach — Task 25), 'news_query' is the
// only value left with no other owner. That's safe here because every test
// below is preceded by a `beforeEach` that deletes today's row for this
// kind, and tests within one file run strictly sequentially (no
// `test.concurrent`), so KIND_A and KIND_B never actually need to be
// distinct — the two names exist only for readability at each call site.
const KIND_A = 'news_query' as const;
const KIND_B = 'news_query' as const;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readCount(kind: 'otp_send' | 'news_query'): Promise<number | null> {
  const [row] = await db
    .select({ count: schema.budgetCounters.count })
    .from(schema.budgetCounters)
    .where(and(eq(schema.budgetCounters.day, todayUtc()), eq(schema.budgetCounters.kind, kind)));
  return row?.count ?? null;
}

describe('consumeBudget / budgetRemaining', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.delete(schema.budgetCounters).where(eq(schema.budgetCounters.kind, KIND_A));
    await db.delete(schema.budgetCounters).where(eq(schema.budgetCounters.kind, KIND_B));
  });

  it('first consume returns true and persists count 1', async () => {
    const ok = await consumeBudget(KIND_A, 5);
    expect(ok).toBe(true);
    expect(await readCount(KIND_A)).toBe(1);
  });

  it('consuming up to the limit returns true; the call that would exceed it returns false', async () => {
    const limit = 3;
    expect(await consumeBudget(KIND_A, limit)).toBe(true); // count -> 1
    expect(await consumeBudget(KIND_A, limit)).toBe(true); // count -> 2
    expect(await consumeBudget(KIND_A, limit)).toBe(true); // count -> 3 (== limit, still true)
    expect(await consumeBudget(KIND_A, limit)).toBe(false); // count -> 4 (> limit)

    // The counter itself still increments on the exhausting call — the
    // caller decides what to do with `false`, but the spend is recorded.
    expect(await readCount(KIND_A)).toBe(4);
  });

  it('budgetRemaining reads without incrementing', async () => {
    await consumeBudget(KIND_A, 10); // count -> 1
    await consumeBudget(KIND_A, 10); // count -> 2

    expect(await budgetRemaining(KIND_A, 10)).toBe(8);
    // Calling again must not change anything — it's a pure read.
    expect(await budgetRemaining(KIND_A, 10)).toBe(8);
    expect(await readCount(KIND_A)).toBe(2);
  });

  it('budgetRemaining before any consume equals the full daily limit', async () => {
    expect(await budgetRemaining(KIND_B, 42)).toBe(42);
  });

  it('budgetRemaining can go negative once exceeded', async () => {
    await consumeBudget(KIND_B, 1); // count -> 1 (== limit, true)
    await consumeBudget(KIND_B, 1); // count -> 2 (> limit, false)
    expect(await budgetRemaining(KIND_B, 1)).toBe(-1);
  });

  it('two sequential increments on the same (day, kind) both persist (race-safety via a single atomic upsert)', async () => {
    // consumeBudget is implemented as ONE `INSERT ... ON CONFLICT DO UPDATE
    // SET count = count + 1 RETURNING count` statement (src/lib/budgets.ts)
    // — there is no separate SELECT-then-INSERT/UPDATE step in application
    // code for a race to land in. This can't simulate a true concurrent
    // race in a unit test, but two calls — issued back to back, and also
    // fired concurrently via Promise.all — must both be reflected in the
    // final count with no lost update, which is what the atomic
    // upsert-increment guarantees.
    const [a, b] = await Promise.all([consumeBudget(KIND_B, 100), consumeBudget(KIND_B, 100)]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(await readCount(KIND_B)).toBe(2);
  });
});
