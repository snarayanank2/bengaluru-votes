/**
 * Smoke spec 3/4 (Task 64, architecture.md §12): flag -> curator accept ->
 * change live on the public page.
 *
 * Two actors, two browser contexts (separate cookie jars — they must never
 * share a session):
 *   1. An anonymous citizen (registers via OTP mid-flow) flags the seeded
 *      candidate's `track_record` field, suggesting a correction.
 *   2. The seeded curator (already-registered contact, plain OTP login)
 *      opens the queue
 *      item this flag created and PUBLISHES a correction.
 *
 * The flag_items row this creates is looked up directly via the DB (rather
 * than scraping the queue list UI for a link) — deterministic and avoids
 * ambiguity across repeated local runs. Note flag_dedupe_uq (unique on
 * target_ref WHERE status='pending') means a PRIOR run's unresolved item
 * (e.g. from a failed earlier attempt) collapses new submissions for the
 * same target onto that SAME flag_item rather than creating a new one —
 * intentional PRD §6.3 behavior — so this spec's own detail text is made
 * distinctive per run (RUN_MARKER) rather than a fixed literal, so its
 * assertions never ambiguously match more than one accumulated submission.
 */
import { test, expect } from '@playwright/test';
import { and, desc, eq } from 'drizzle-orm';
import { seedFixtures, freshEmail } from './support/fixtures';
import { registerNewUser, loginExistingUser } from './support/auth';
import { db } from './support/db';
import { flagItems } from '../../src/db/schema';

const candidateSlug = seedFixtures.candidateSlug;
const candidateId = seedFixtures.candidateId;
const wardId = seedFixtures.primaryWardId;
const targetRef = `candidate:${candidateId}:track_record`;
const RUN_MARKER = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const CORRECTED_VALUE = `Corrected track record (E2E ${RUN_MARKER})`;
// A distinctive-per-run detail string: the flag_items dedupe (flag_dedupe_uq,
// unique on target_ref WHERE status='pending') means repeated local runs of
// this exact target can collapse onto one already-pending flag_item with
// MULTIPLE flag_submissions rows — a fixed literal detail string would then
// match more than one rendered <p class="detail"> on the queue item page.
const FLAG_DETAIL = `The current value is out of date (E2E test ${RUN_MARKER}).`;

async function findPendingFlagItemId(): Promise<number> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ id: flagItems.id })
      .from(flagItems)
      .where(and(eq(flagItems.targetRef, targetRef), eq(flagItems.status, 'pending')))
      .orderBy(desc(flagItems.createdAt))
      .limit(1);
    if (row) return row.id;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`flag.spec: no pending flag_items row for ${targetRef} appeared in time`);
}

test('citizen flags a candidate field, curator accepts + publishes, correction goes live', async ({ browser }) => {
  // Two full OTP round-trips (citizen registration + curator login) plus
  // three separate browser contexts/page loads — comfortably over the
  // default 30s budget on a slower run.
  test.setTimeout(60_000);

  const citizenContext = await browser.newContext();
  const citizenPage = await citizenContext.newPage();

  await citizenPage.goto(`/candidate/${candidateSlug}`);

  // Baseline value from scripts/seed-e2e.ts is visible before any flag.
  await expect(citizenPage.getByText('Two-term corporator (E2E FIXTURE BASELINE)')).toBeVisible();

  await citizenPage.locator('[data-flag-action]').click();

  // FlagModal.ts's /api/me check found the visitor anonymous and opened
  // Register/Login first (core concept 2: gated at submit, resumed in place).
  await registerNewUser(citizenPage, { destination: freshEmail('flagger'), wardId });

  const flagDialog = citizenPage.locator('[data-flag-modal]');
  await expect(flagDialog).toBeVisible();

  // The five report-card targets render as a radio list (Candidate.astro's
  // REPORT_CARD_FIELD_KEYS order); 'track_record' is first and pre-checked.
  await expect(flagDialog.locator('input[name="targetRef"]').first()).toHaveValue(targetRef);
  await flagDialog.locator('textarea[name="detail"]').fill(FLAG_DETAIL);
  await flagDialog.locator('input[name="suggestedValue"]').fill(CORRECTED_VALUE);
  await flagDialog.locator('[data-flag-submit]').click();

  await expect(citizenPage.locator('[data-flag-success-toast]')).toBeVisible();
  await expect(flagDialog).toBeHidden();

  const flagItemId = await findPendingFlagItemId();

  // --- second actor: the seeded curator, a fully separate session ---------
  const curatorContext = await browser.newContext();
  const curatorPage = await curatorContext.newPage();

  await curatorPage.goto('/curator/queue');
  // No session yet -> middleware redirects to /login?next=... ; sign in
  // with the already-registered curator contact (plain OTP login, no
  // registration step).
  await expect(curatorPage).toHaveURL(/\/login/);
  await curatorPage.locator('[data-me-slot]').click();
  await loginExistingUser(curatorPage, seedFixtures.curatorEmail);

  await curatorPage.goto(`/curator/queue/${flagItemId}`);
  await expect(curatorPage.getByText(FLAG_DETAIL)).toBeVisible();

  const acceptForm = curatorPage.locator('form', { has: curatorPage.locator('input[name="valueEn"]') });
  await acceptForm.locator('input[name="valueEn"]').fill(CORRECTED_VALUE);
  await acceptForm.locator('input[name="sourceUrl"]').fill('https://example.org/e2e-curator-correction');
  await acceptForm.locator('input[name="confirmPublish"]').check();
  await acceptForm.locator('button[type="submit"]').click();

  await expect(curatorPage).toHaveURL(/\/curator\/queue$/);

  // --- back to the PUBLIC page, a fresh load, no session at all -----------
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(`/candidate/${candidateSlug}`);

  await expect(publicPage.getByText(CORRECTED_VALUE)).toBeVisible();
  await expect(publicPage.getByText('Two-term corporator (E2E FIXTURE BASELINE)')).toHaveCount(0);

  await citizenContext.close();
  await curatorContext.close();
  await publicContext.close();
});
