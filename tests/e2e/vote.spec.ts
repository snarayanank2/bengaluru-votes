import { test, expect } from '@playwright/test';
import { seedFixtures } from './support/fixtures';

const wardId = seedFixtures.primaryWardId;

test('anonymous visitor votes inline and the receipt survives reload', async ({ page }) => {
  await page.goto(`/ward/${wardId}`);
  const zone = page.locator('[data-issue-vote-zone]');
  const choices = zone.locator('input[type="checkbox"]');
  await expect(choices.first()).toBeVisible();
  await expect(zone.locator('[data-vote-submit]')).toBeDisabled();
  for (let i = 0; i < 3; i++) await choices.nth(i).check();
  await zone.locator('[data-vote-submit]').click();
  await expect(zone.locator('[data-vote-success]')).toBeVisible();
  await expect(zone.locator('[data-vote-instructions]')).toBeHidden();
  await expect(zone.locator('[data-vote-results-intro]')).toBeVisible();
  await expect(zone.locator('[data-vote-selections] li')).toHaveCount(3);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/ward/${wardId}$`));
  await expect(zone.locator('.issue-result')).toHaveCount(3);
  await page.reload();
  await expect(zone.locator('[data-vote-form-wrap]')).toBeHidden();
  await expect(zone.locator('[data-vote-instructions]')).toBeHidden();
  await expect(zone.locator('[data-vote-selections] li')).toHaveCount(3);
  await expect(zone.locator('.issue-result')).toHaveCount(3);
});
