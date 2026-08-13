/**
 * Final-review Fix 5 — jobs/run-campaign.ts must exit NON-ZERO when the run
 * recorded errors (calendar.ts:419-427's exit-nonzero-on-errors contract), so
 * a fully/partially failed run doesn't report success to cron/monitoring.
 * Focused unit coverage of the pure exit-code decision (`exitCodeForSummary`)
 * plus `main()` returning the summary the entrypoint bases that decision on.
 *
 * Importing the entrypoint pulls in src/lib/send/calendar -> src/db/client at
 * module scope, so DATABASE_URL must be set for the import to succeed (same
 * guard as tests/unit/curator.test.ts); `runCampaign` is mocked, so no DB is
 * actually touched.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CampaignRunSummary } from '../../src/lib/send/calendar';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

vi.mock('../../src/lib/send/calendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/send/calendar')>();
  return { ...actual, runCampaign: vi.fn() };
});

import { runCampaign } from '../../src/lib/send/calendar';
import { exitCodeForSummary, main } from '../../jobs/run-campaign';

function summary(overrides: Partial<CampaignRunSummary> = {}): CampaignRunSummary {
  return { due: [], guardrailTripped: [], perCode: {}, errors: 0, ...overrides };
}

describe('jobs/run-campaign.ts exit-nonzero-on-errors (Fix 5)', () => {
  it('exitCodeForSummary: errors > 0 -> 1', () => {
    expect(exitCodeForSummary(summary({ errors: 3 }))).toBe(1);
    expect(exitCodeForSummary(summary({ errors: 1 }))).toBe(1);
  });

  it('exitCodeForSummary: a clean run (errors === 0) -> 0', () => {
    expect(exitCodeForSummary(summary({ errors: 0, due: ['R1'] }))).toBe(0);
  });

  it('exitCodeForSummary: a pure guardrail trip with no errors is a refusal, NOT a failure -> 0', () => {
    expect(exitCodeForSummary(summary({ guardrailTripped: ['R1'], errors: 0 }))).toBe(0);
  });

  it('main() returns the run summary, so the entrypoint drives a non-zero exit when errors > 0', async () => {
    vi.mocked(runCampaign).mockResolvedValueOnce(summary({ due: ['R1'], errors: 2 }));
    const result = await main();
    expect(result.errors).toBe(2);
    expect(exitCodeForSummary(result)).toBe(1); // what the entrypoint's process.exit(...) receives
  });

  it('main() on a clean run yields exit code 0', async () => {
    vi.mocked(runCampaign).mockResolvedValueOnce(summary({ due: ['R1'], errors: 0 }));
    const result = await main();
    expect(exitCodeForSummary(result)).toBe(0);
  });
});
