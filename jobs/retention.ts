#!/usr/bin/env tsx
/**
 * DPDP retention enforcement (Task 55; dormant — architecture §15). The proposed policy:
 * citizen contact data deleted/anonymized within 3 months of GBA results
 * being declared. This period is **NOT YET LEGALLY
 * CONFIRMED** — until legal sign-off lands, this job MUST NOT erase
 * anyone.
 *
 * =========================================================================
 * SHIPS DISABLED — THE DISABLED GUARD IS THE REAL DELIVERABLE OF THIS FILE
 * =========================================================================
 * Unless `RETENTION_ENABLED === 'true'` (an explicit, deliberate flip —
 * never a default), `main()` logs one LOUD line and returns having done
 * NOTHING: no query against `users`, no call to `eraseUser`. This is not
 * a placeholder to "finish later" — it is the correct behavior until legal
 * confirmation of the retention period exists, and this guard is checked FIRST, before
 * any other code in this file runs.
 *
 * THE ENABLED PATH (scaffolded, not battle-tested — do not treat this as
 * "the retention period is resolved"; see docs/architecture.md
 * Open questions):
 *   - `results_declared_at` is read from `app_settings` (the same
 *     key/value table architecture.md's schema section calls out for
 *     "election anchors" like `election_date`/`roll_deadline` — no
 *     dedicated column for it exists yet, so this is where the value is
 *     expected to live once someone sets it).
 *   - The cutoff is `results_declared_at + RETENTION_PERIOD_DAYS` (default
 *     90, matching the proposed "3 months" — override via env once
 *     the real confirmed period is known). If `now` hasn't reached the
 *     cutoff yet, this exits having erased no one — same as disabled, but
 *     for a different, expected reason ("not due yet" vs "not turned on").
 *   - SCOPE ASSUMPTION (flagged, not resolved): eligible users are
 *     `role = 'citizen'` and not already `status = 'erased'`. The
 *     proposed policy text names "citizen contact data" specifically;
 *     curator/admin accounts are staff accounts with an ongoing
 *     operational role, so this job does not touch them. This scope
 *     should be reconfirmed alongside the retention-period legal
 *     sign-off itself, not assumed correct from this comment alone.
 *   - Erasure runs through `src/lib/erasure.ts`'s `eraseUser` (Task 45) —
 *     the one DPDP erasure routine every other erasure path already uses
 *     — as a configured system-admin actor (`RETENTION_ACTOR_USER_ID`),
 *     never as the citizen themselves. Each user's erasure is isolated in
 *     its own try/catch (same per-user isolation convention as
 *     src/lib/send/calendar.ts's `runCampaign`) so one bad row can't abort
 *     the whole batch.
 */
import { and, eq, ne } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { db } from '../src/db/client';
import { appSettings, users } from '../src/db/schema';
import { eraseUser, type AdminActor } from '../src/lib/erasure';
import { captureException } from '../src/lib/logger';
import { logEvent } from '../src/lib/log';

const RESULTS_DECLARED_AT_KEY = 'results_declared_at';
/** The PROPOSED period ("3 months of results being declared") — not yet legally confirmed. Override via env once it is. */
const DEFAULT_RETENTION_PERIOD_DAYS = 90;

export interface RetentionSummary {
  enabled: boolean;
  reason?: string;
  erased: number;
  errors: number;
}

export async function main(): Promise<RetentionSummary> {
  if (process.env.RETENTION_ENABLED !== 'true') {
    // LOUD, unconditional, first thing this function does. See module
    // docstring — this line, not the code below it, is the deliverable.
    console.warn('retention: DISABLED pending legal sign-off on the retention period — no users will be erased');
    const summary: RetentionSummary = { enabled: false, erased: 0, errors: 0 };
    console.log(JSON.stringify({ event: 'retention_run_summary', ...summary }));
    return summary;
  }

  const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, RESULTS_DECLARED_AT_KEY));
  if (!setting) {
    const summary: RetentionSummary = { enabled: true, reason: 'results_declared_at not set', erased: 0, errors: 0 };
    console.log(JSON.stringify({ event: 'retention_run_summary', ...summary }));
    return summary;
  }

  const periodDays = Number(process.env.RETENTION_PERIOD_DAYS ?? DEFAULT_RETENTION_PERIOD_DAYS);
  const declaredAt = new Date(setting.value);
  const cutoff = new Date(declaredAt.getTime() + periodDays * 24 * 60 * 60 * 1000);
  const now = new Date();

  if (now < cutoff) {
    const summary: RetentionSummary = {
      enabled: true,
      reason: `not yet due (cutoff ${cutoff.toISOString()})`,
      erased: 0,
      errors: 0,
    };
    console.log(JSON.stringify({ event: 'retention_run_summary', ...summary }));
    return summary;
  }

  const actorUserIdRaw = process.env.RETENTION_ACTOR_USER_ID;
  if (!actorUserIdRaw) {
    throw new Error('retention: RETENTION_ENABLED=true but RETENTION_ACTOR_USER_ID is not set');
  }
  const actor: AdminActor = { userId: Number(actorUserIdRaw), role: 'admin' };

  // SCOPE ASSUMPTION — see module docstring.
  const eligible = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'citizen'), ne(users.status, 'erased')));

  let erased = 0;
  let errors = 0;
  for (const user of eligible) {
    try {
      await eraseUser(actor, user.id);
      erased += 1;
    } catch {
      // PER-USER isolation (same convention as calendar.ts's
      // runCampaign) — one bad row must never abort the whole batch. No
      // PII: only the (already-opaque, post-tombstone) id is logged.
      logEvent('retention_erase_error', { userId: user.id });
      errors += 1;
    }
  }

  const summary: RetentionSummary = { enabled: true, erased, errors };
  console.log(JSON.stringify({ event: 'retention_run_summary', ...summary }));
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
