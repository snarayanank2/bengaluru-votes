/**
 * Smoke spec 1/4 (Task 64, architecture.md §12): ward lookup + ward page.
 *
 * WHAT THIS CAN AND CANNOT COVER, AND WHY. Until 2026-08-14 this spec drove
 * the PINCODE path, deliberately: the geocode path needs a Google API key
 * this environment does not have, and pincode lookup answered without one.
 * Pincode lookup was removed (see the header of
 * src/pages/api/ward-lookup.ts), so address geocoding is now the only way to
 * resolve a ward — and with no key, it cannot succeed here.
 *
 * So the happy path (typed address -> resolved ward) is NOT covered by E2E
 * any more. That is a real coverage loss, not an oversight: it is asserted
 * at the route level instead, against a mocked geocoder
 * (tests/routes/ward-lookup.test.ts, tests/routes/home.test.ts).
 *
 * What IS still worth asserting end to end, and is asserted below:
 *  1. The lookup round-trips. The island loads, intercepts the submit, POSTs
 *     to the real API, and paints a real answer back into the aria-live
 *     container without a page navigation. With no key the answer is the
 *     `unavailable` outage message — which is exactly the state a citizen
 *     would see if the geocode budget were exhausted in production, so the
 *     assertion has its own value beyond wiring.
 *  2. Ward pages render. Reached directly by seeded id, since lookup can no
 *     longer navigate there in this environment.
 */
import { test, expect } from '@playwright/test';
import { seedFixtures } from './support/fixtures';

test('ward lookup round-trips through the island and paints an answer without navigating', async ({ page }) => {
  await page.goto('/');
  // WardLookup.ts (the island that intercepts this form's submit and calls
  // the API instead of a full page POST) ships as an external module
  // script — wait for it to actually finish loading/executing before
  // interacting, or a fast `fill`+`click` can race ahead of the listener
  // attaching and fall through to a real cross-site-checked form POST.
  await page.waitForLoadState('networkidle');

  const urlBefore = page.url();

  await page.locator('[data-ward-lookup] input[name="query"]').fill('MG Road, Bengaluru');
  await page.locator('[data-ward-lookup] button[type="submit"]').click();

  const result = page.locator('[data-ward-result]');
  await expect(result).not.toBeEmpty();
  // No key in this environment, so the geocoder fails and the endpoint
  // answers `unavailable` — the citizen gets a message, never a ward link.
  await expect(result.locator('a')).toHaveCount(0);
  // The island handled it: no full-page POST navigation happened.
  expect(page.url()).toBe(urlBefore);
});

test('a seeded ward page renders', async ({ page }) => {
  const wardId = seedFixtures.primaryWardId;

  await page.goto(`/ward/${wardId}`);

  await expect(page).toHaveURL(new RegExp(`/ward/${wardId}$`));
  await expect(page.locator('h1')).toBeVisible();
  // The map container is server-rendered either way — with maps disabled it
  // carries only the no-JS fallback text, which is the state this
  // environment runs in. Asserting the container (not a canvas) keeps this
  // deterministic whether or not a browser key is configured.
  await expect(page.locator('.map-container')).toBeVisible();
});
