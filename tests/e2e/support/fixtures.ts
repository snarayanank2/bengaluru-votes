/**
 * Reads back the deterministic fixture ids `npm run seed:e2e` (scripts/
 * seed-e2e.ts) wrote to `tests/e2e/.fixtures.json`, plus the static pincode
 * shortlist used by lookup.spec.ts (read straight from data/pincode-wards.json
 * rather than hardcoded, so it can never drift from the real lookup table).
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
const PINCODE_WARDS_PATH = path.join(__dirname, '..', '..', '..', 'data', 'pincode-wards.json');

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

/** A known-good synthetic pincode from data/pincode-wards.json (see that file's own "__note" for why 999xxx is synthetic-but-safe) and the wards it should shortlist to. */
function loadLookupPincodeFixture(): { pincode: string; wardIds: number[] } {
  const table = JSON.parse(readFileSync(PINCODE_WARDS_PATH, 'utf8')) as Record<string, unknown>;
  const pincode = '999001';
  const wardIds = table[pincode];
  if (!Array.isArray(wardIds) || wardIds.length === 0) {
    throw new Error(`data/pincode-wards.json has no entry for ${pincode} — lookup.spec.ts depends on it.`);
  }
  return { pincode, wardIds: wardIds as number[] };
}

export const seedFixtures = loadSeedFixtures();
export const lookupFixture = loadLookupPincodeFixture();

/** A fresh, distinctive email per test run/file — avoids OTP cooldown/dedupe collisions across repeated local runs. */
export function freshEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}
