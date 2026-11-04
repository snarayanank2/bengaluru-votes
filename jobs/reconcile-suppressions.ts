#!/usr/bin/env tsx
/**
 * Daily reconciliation of `suppressions` against SendGrid's own
 * suppression lists (Task 55; dormant — architecture §15. The safety
 * net if a webhook event is ever lost; Task 53's bounce/complaint
 * webhooks being the primary path).
 *
 * ENV-GATED, same graceful-skip posture as src/lib/send/sendgrid.ts: no
 * `SENDGRID_API_KEY` means this logs one line and exits 0 — nothing is
 * fetched, nothing throws.
 *
 * SENDGRID v3 SUPPRESSION ENDPOINTS (ASSUMED SHAPE — this job has never
 * run against a live SendGrid account; implemented against SendGrid's
 * documented v3 API. If the real shape differs, the env-gate means this
 * no-ops safely everywhere else until it's actually configured and can be
 * checked against a real account):
 *   - GET /v3/suppression/bounces         -> [{ email, reason, ... }]
 *   - GET /v3/suppression/spam_reports    -> [{ email, ... }]
 *   - GET /v3/asm/suppressions/global     -> [{ email, ... }]
 * Each is fetched ONE PAGE (`?limit=1000`) per run — SendGrid suppression
 * lists are typically small and this job runs daily, so a day's worth of
 * new suppressions comfortably fits one page; full pagination is left for
 * if that assumption ever breaks (would show up as this job's counts
 * staying flat while SendGrid's own dashboard count keeps climbing).
 *
 * `addSuppression` (src/lib/suppressions.ts) is idempotent on
 * `(contact, channel)`, so this just calls it for every row SendGrid
 * returns — no need to diff against what's already stored.
 *
 * NO PII IN LOGS: the summary below carries only counts per list, never
 * an email address (architecture §13).
 *
 * RESILIENT, NOT FRAGILE: a fetch failure (network error, non-2xx) is
 * caught, logged, and this job exits 1 — it never throws uncaught, so a
 * wedged SendGrid API never crashes the jobs container's cron process,
 * it just fails this one run (and cron/monitoring notices the nonzero
 * exit).
 */
import { pathToFileURL } from 'node:url';
import { addSuppression, type SuppressionReason } from '../src/lib/suppressions';
import { captureException } from '../src/lib/logger';

interface SendGridSuppressionRow {
  email?: string;
}

async function fetchSuppressionList(apiKey: string, endpoint: string): Promise<SendGridSuppressionRow[]> {
  const url = `https://api.sendgrid.com/v3${endpoint}?limit=1000`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    throw new Error(`reconcile-suppressions: ${endpoint} returned ${res.status}`);
  }
  const body = (await res.json()) as SendGridSuppressionRow[];
  return Array.isArray(body) ? body : [];
}

async function reconcileList(apiKey: string, endpoint: string, reason: SuppressionReason): Promise<number> {
  const rows = await fetchSuppressionList(apiKey, endpoint);
  let count = 0;
  for (const row of rows) {
    if (!row.email) continue;
    await addSuppression(row.email, 'email', reason);
    count += 1;
  }
  return count;
}

export async function main(): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    console.log('reconcile-suppressions: not configured, skipping');
    return;
  }

  const bounces = await reconcileList(apiKey, '/suppression/bounces', 'bounce');
  const spamReports = await reconcileList(apiKey, '/suppression/spam_reports', 'complaint');
  const globalUnsubscribes = await reconcileList(apiKey, '/asm/suppressions/global', 'stop');

  console.log(
    JSON.stringify({
      event: 'reconcile_suppressions_run_summary',
      bounces,
      spamReports,
      globalUnsubscribes,
    }),
  );
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
