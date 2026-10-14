/**
 * Smoke spec 3/4 (Task 64, architecture.md §12): flag -> curator accept ->
 * change live on the public page.
 *
 * Two actors, two browser contexts (separate cookie jars — they must never
 * share a session):
 *   1. An anonymous citizen (registers via OTP mid-flow) flags the seeded
 *      candidate's `age` field, suggesting a correction.
 *   2. The seeded curator (already-registered contact, plain OTP login on
 *      the /login page)
 *      opens the queue item this flag created, types the corrected age into
 *      the structured fix form beside the affidavit, ticks the confirmation
 *      and PUBLISHES it.
 *
 * The corrected age alternates between the two in scripts/seed-e2e.ts
 * (E2E_FLAG_AGES), chosen from what is published when the run starts, so a
 * repeated local run always changes the value (a fix identical to what is
 * published is refused).
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
import { test, expect, type Locator, type Page } from '@playwright/test';
import { and, desc, eq } from 'drizzle-orm';
import { seedFixtures, freshEmail } from './support/fixtures';
import { registerNewUser } from './support/auth';
import { readLatestOtpCode } from './support/otp-sink';
import { db } from './support/db';
import { candidateFields, flagItems } from '../../src/db/schema';

// Kept in step with scripts/seed-e2e.ts (E2E_FLAG_FIELD_KEY, E2E_FLAG_AGES)
// by hand: importing that module here would pull the app's publish code,
// and its JSON imports, into Playwright's loader.
const E2E_FLAG_FIELD_KEY = 'age';
const E2E_FLAG_AGES = [41, 42] as const;

const candidateSlug = seedFixtures.candidateSlug;
const candidateId = seedFixtures.candidateId;
const wardId = seedFixtures.primaryWardId;
const targetRef = `candidate:${candidateId}:${E2E_FLAG_FIELD_KEY}`;
const RUN_MARKER = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
// A distinctive-per-run detail string: the flag_items dedupe (flag_dedupe_uq,
// unique on target_ref WHERE status='pending') means repeated local runs of
// this exact target can collapse onto one already-pending flag_item with
// MULTIPLE flag_submissions rows — a fixed literal detail string would then
// match more than one rendered <p class="detail"> on the queue item page.
const FLAG_DETAIL = `The current value is out of date (E2E test ${RUN_MARKER}).`;

/** The age published for the seeded candidate right now, read from its structured value. */
async function publishedAge(): Promise<number> {
  const [row] = await db
    .select({ valueData: candidateFields.valueData })
    .from(candidateFields)
    .where(and(eq(candidateFields.candidateId, candidateId), eq(candidateFields.fieldKey, E2E_FLAG_FIELD_KEY)));
  const data = row?.valueData as { key?: string; years?: number | null } | null | undefined;
  if (data?.key !== 'age' || typeof data.years !== 'number') {
    throw new Error('flag.spec: the seeded candidate has no structured age — run `npm run seed:e2e` first');
  }
  return data.years;
}

/** The report-card value that is exactly this age (the row's own `<p>`, so a bare number cannot match inside another value). */
function ageValue(page: Page, age: number): Locator {
  return page.locator('p.profile-field__value', { hasText: new RegExp(`^\\s*${age}\\s*$`) });
}

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

  const baselineAge = await publishedAge();
  const correctedAge = baselineAge === E2E_FLAG_AGES[0] ? E2E_FLAG_AGES[1] : E2E_FLAG_AGES[0];

  const citizenContext = await browser.newContext();
  const citizenPage = await citizenContext.newPage();

  await citizenPage.goto(`/candidate/${candidateSlug}`);

  // The published age is visible before any flag.
  await expect(ageValue(citizenPage, baselineAge)).toBeVisible();

  await citizenPage.locator('[data-flag-action]').click();

  // FlagModal.ts's /api/me check found the visitor anonymous and opened
  // Register/Login first (core concept 2: gated at submit, resumed in place).
  await registerNewUser(citizenPage, { destination: freshEmail('flagger'), wardId });

  const flagDialog = citizenPage.locator('[data-flag-modal]');
  await expect(flagDialog).toBeVisible();

  // The eight flaggable fields render as a radio list (Candidate.astro,
  // FLAGGABLE_FIELD_KEYS order) with the first pre-checked; pick the age.
  await flagDialog.locator(`input[name="targetRef"][value="${targetRef}"]`).check();
  await flagDialog.locator('textarea[name="detail"]').fill(FLAG_DETAIL);
  await flagDialog.locator('input[name="suggestedValue"]').fill(String(correctedAge));
  await flagDialog.locator('[data-flag-submit]').click();

  await expect(citizenPage.locator('[data-flag-success-toast]')).toBeVisible();
  await expect(flagDialog).toBeHidden();

  const flagItemId = await findPendingFlagItemId();

  // --- second actor: the seeded curator, a fully separate session ---------
  const curatorContext = await browser.newContext();
  const curatorPage = await curatorContext.newPage();

  await curatorPage.goto('/curator/queue');
  // No session yet -> middleware redirects to /login?next=... ; sign in
  // with the already-registered curator contact through that page's own
  // two forms (contact, then the code). The app bar no longer carries a
  // sign-in control, so there is no modal to open here.
  await expect(curatorPage).toHaveURL(/\/login/);
  await curatorPage.locator('main input[name="destination"]').fill(seedFixtures.curatorEmail);
  await curatorPage.locator('main button[type="submit"]').click();
  await curatorPage.locator('main input[name="code"]').fill(await readLatestOtpCode(seedFixtures.curatorEmail));
  await curatorPage.locator('main button[type="submit"]').click();
  await expect(curatorPage).toHaveURL(/\/curator\/queue$/);

  await curatorPage.goto(`/curator/queue/${flagItemId}`);
  await expect(curatorPage.getByText(FLAG_DETAIL)).toBeVisible();

  // The structured fix form: the field's own inputs, opened on what is published.
  const fixForm = curatorPage.locator('form', { has: curatorPage.locator('input[name="age"]') });
  await expect(fixForm.locator('input[name="age"]')).toHaveValue(String(baselineAge));
  await fixForm.locator('input[name="age"]').fill(String(correctedAge));
  await fixForm.locator('input[name="confirmPublish"]').check();
  await fixForm.getByRole('button', { name: 'Fix and publish' }).click();

  await expect(curatorPage).toHaveURL(/\/curator\/queue$/);

  // --- back to the PUBLIC page, a fresh load, no session at all -----------
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(`/candidate/${candidateSlug}`);

  await expect(ageValue(publicPage, correctedAge)).toBeVisible();
  await expect(ageValue(publicPage, baselineAge)).toHaveCount(0);
  expect(await publishedAge()).toBe(correctedAge);

  await citizenContext.close();
  await curatorContext.close();
  await publicContext.close();
});
