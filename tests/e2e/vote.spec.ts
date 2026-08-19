/**
 * Smoke spec 2/4 (Task 64, architecture.md §12): register (OTP) -> cast an
 * issue vote -> results update.
 *
 * Flow: open the seeded ward's issues page (anonymous) -> tap "Vote your
 * top 3" (VoteModal.ts checks /api/me, finds the visitor anonymous, and
 * opens the Register/Login modal FIRST) -> register a brand-new contact via
 * the OTP sink -> the vote flow RESUMES IN PLACE (no page reload, no URL
 * change - core concept 2) -> the vote form shows (now authed, home ward
 * matches) -> check the ward's one seeded issue -> submit -> the public
 * results bar updates to 100% with no page reload, AND persists across a
 * reload/reopen (proof it's really recorded server-side, not just a
 * client-side illusion).
 */
import { test, expect } from '@playwright/test';
import { seedFixtures, freshEmail } from './support/fixtures';
import { registerNewUser } from './support/auth';

const wardId = seedFixtures.primaryWardId;

test('anonymous visitor registers via OTP, casts an issue vote, and the results reflect it', async ({ page }) => {
  const destination = freshEmail('voter');

  await page.goto(`/ward/${wardId}`);

  const voteButton = page.locator('[data-vote-action]');
  await expect(voteButton).toBeVisible();
  await voteButton.click();

  // VoteModal.ts's /api/me check found the visitor anonymous and opened
  // Register/Login first. Complete registration with THIS ward as home ward.
  await registerNewUser(page, { destination, wardId });

  // Resumed in place: the URL never changed, and the vote form (not the
  // home-ward-only message) is now showing, pre-checked with nothing yet.
  await expect(page).toHaveURL(new RegExp(`/ward/${wardId}$`));
  const voteDialog = page.locator('[data-vote-modal]');
  await expect(voteDialog.locator('[data-vote-form-wrap]')).toBeVisible();
  await expect(voteDialog.locator('[data-vote-home-ward-wrap]')).toBeHidden();

  const issueCheckbox = voteDialog.locator('[data-vote-issue-options] input[type="checkbox"]').first();
  await issueCheckbox.check();
  await voteDialog.locator('[data-vote-submit]').click();

  // Success toast + the modal closes + the page's own results bar (spliced
  // client-side, no reload) shows this ward's one issue at 100% share.
  await expect(page.locator('[data-vote-success-toast]')).toBeVisible();
  await expect(voteDialog).toBeHidden();

  const resultBar = page.locator('[data-issue-bars] .issue-bar').first();
  await expect(resultBar.locator('.share')).toHaveText('100%');

  // Reload the page cold (fresh server render, no client-side state left
  // over) — the same 100% share must still be there, proving the vote was
  // actually persisted server-side, not just spliced into the DOM.
  await page.reload();
  await expect(page.locator('[data-issue-bars] .issue-bar').first().locator('.share')).toHaveText('100%');

  // Reopening the vote modal pre-checks the visitor's own recorded
  // selection (VoteModal.ts's GET /api/issue-votes pre-check) — a second,
  // independent proof the vote is recorded against this account, not just
  // reflected in the public aggregate.
  await page.locator('[data-vote-action]').click();
  await expect(page.locator('[data-vote-modal] [data-vote-issue-options] input[type="checkbox"]').first()).toBeChecked();
});
