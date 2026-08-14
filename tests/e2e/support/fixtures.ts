/**
 * Reads back the deterministic fixture ids `npm run seed:e2e` (scripts/
 * seed-e2e.ts) wrote to `tests/e2e/.fixtures.json`.
 *
 * A `lookupFixture` (a synthetic pincode and the wards it shortlisted to)
 * used to live here for lookup.spec.ts. Pincode lookup was removed
 * 2026-08-14 — see the header of src/pages/api/ward-lookup.ts — and
 * data/pincode-wards.json went with it.
 *
 * Reading a JSON file synchronously here — rather than re-querying the DB
 * from every spec — keeps each spec file's setup to one import, and keeps
 * the seed step (which DOES need a DB connection) a separate, explicit
 * command a human runs before `playwright test` (see this repo's
 * task-64 report for the exact sequence).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SeedE2EResult } from '../../../scripts/seed-e2e';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURES_PATH = path.join(__dirname, '..', '.fixtures.json');

function loadSeedFixtures(): SeedE2EResult {
  let raw: string;
  try {
    raw = readFileSync(FIXTURES_PATH, 'utf8');
  } catch {
    throw new Error(
      `tests/e2e/.fixtures.json not found — run \`npm run seed:e2e\` (against the same DATABASE_URL ` +
        `playwright.config.ts's webServer uses) before \`npx playwright test\`.`,
    );
  }
  return JSON.parse(raw) as SeedE2EResult;
}

export const seedFixtures = loadSeedFixtures();

/** A fresh, distinctive email per test run/file — avoids OTP cooldown/dedupe collisions across repeated local runs. */
export function freshEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}
