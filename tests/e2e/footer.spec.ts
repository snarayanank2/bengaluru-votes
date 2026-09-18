import { test, expect } from '@playwright/test';

test('the footer keeps its branded hierarchy, light partner marks, and white social controls', async ({ page }) => {
  await page.goto('/');

  const footer = page.locator('.site-footer');
  await expect(footer.locator('.footer-brand')).toHaveText('Bengaluru Votes');
  await expect(footer.locator('.partner-chip')).toHaveCount(0);
  await expect(footer.locator('img[src="/img/janaagraha-logo.svg"]')).toBeVisible();
  await expect(footer.locator('img[src="/img/oorvani-logo-white.png"]')).toBeVisible();

  const brandFontSize = await footer.locator('.footer-brand').evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize),
  );
  const labelFontSize = await footer.locator('.partners-label').evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).fontSize),
  );
  expect(brandFontSize).toBeGreaterThan(labelFontSize);

  const socialLinks = footer.locator('.social-links a');
  await expect(socialLinks).toHaveCount(3);
  for (const socialLink of await socialLinks.all()) {
    const styles = await socialLink.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { color: computed.color, minHeight: computed.minHeight, minWidth: computed.minWidth };
    });
    expect(styles).toEqual({ color: 'rgb(255, 255, 255)', minHeight: '44px', minWidth: '44px' });
  }
});
