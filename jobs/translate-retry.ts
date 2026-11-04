#!/usr/bin/env tsx
/**
 * Thin cron entrypoint that retries stuck translations (Task 55; Task 40's
 * src/lib/translate-runtime.ts). Every publish path calls
 * `translateFieldSoon`, a FIRE-AND-FORGET call — that module's docstring
 * is explicit that a `'pending'` outcome means "the translator timed out,
 * threw, or (no `ANTHROPIC_API_KEY`) was never attempted; `jobs` retries."
 * This is that retry: every 5 minutes (deploy/crontab), find every row
 * across the two translatable tables still `translationStatus:
 * 'pending'` and re-drive it.
 *
 * WHY THIS AWAITS instead of calling `translateFieldSoon`: that function
 * is deliberately synchronous `void` — fine for a long-lived server
 * process, wrong for a one-shot cron job. A `tsx jobs/X.ts` invocation
 * calls `process.exit()` on completion (see the guard below: a one-shot
 * job must exit explicitly rather than let the DB pool's open connections
 * keep the event loop alive) — if this job fired-and-forgot each retry, `exit(0)`
 * could kill those in-flight promises before they ever wrote anything,
 * silently discarding the very retries this job exists to perform. So
 * this job calls the AWAITABLE `translateFieldNow` directly, one row at a
 * time, and only exits once every row has actually resolved.
 *
 * No PII: the summary below carries only per-table counts of outcomes
 * (translate-runtime.ts's `TranslateOutcome` union), never field content.
 */
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { db } from '../src/db/client';
import { candidateFields, wardIssues } from '../src/db/schema';
import { translateFieldNow, type TranslateTable, type TranslateOutcome } from '../src/lib/translate-runtime';
import { captureException } from '../src/lib/logger';

const TABLES: TranslateTable[] = ['candidate_fields', 'ward_issues'];

async function pendingIds(table: TranslateTable): Promise<number[]> {
  if (table === 'candidate_fields') {
    const rows = await db.select({ id: candidateFields.id }).from(candidateFields).where(eq(candidateFields.translationStatus, 'pending'));
    return rows.map((r) => r.id);
  }
  const rows = await db.select({ id: wardIssues.id }).from(wardIssues).where(eq(wardIssues.translationStatus, 'pending'));
  return rows.map((r) => r.id);
}

export interface TranslateRetrySummary {
  perTable: Record<TranslateTable, Record<TranslateOutcome, number>>;
  totalConsidered: number;
}

function emptyOutcomeCounts(): Record<TranslateOutcome, number> {
  return { done: 0, pending: 0, skipped: 0, manual: 0 };
}

export async function main(): Promise<TranslateRetrySummary> {
  const summary: TranslateRetrySummary = {
    perTable: {
      candidate_fields: emptyOutcomeCounts(),
      ward_issues: emptyOutcomeCounts(),
    },
    totalConsidered: 0,
  };

  for (const table of TABLES) {
    const ids = await pendingIds(table);
    for (const id of ids) {
      summary.totalConsidered += 1;
      // AWAITED, not fire-and-forget — see module docstring.
      const outcome = await translateFieldNow({ table, id });
      summary.perTable[table][outcome] += 1;
    }
  }

  console.log(JSON.stringify({ event: 'translate_retry_run_summary', ...summary }));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      captureException(err);
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
