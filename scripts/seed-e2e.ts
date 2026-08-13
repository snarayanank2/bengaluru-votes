#!/usr/bin/env tsx
/**
 * Deterministic seed for the Playwright smoke suite (Task 64,
 * .superpowers/sdd/task-64-brief.md). Layers a handful of e2e-specific
 * fixtures on top of the same seed functions `npm run seed:wards` /
 * `npm run seed:dev` already use, so specs get a stable, known-shape
 * dataset without hardcoding ward ids that depend on data/gba.geojson's
 * exact contents:
 *
 *   1. seedWards  — all 369 real wards (idempotent upsert).
 *   2. seedDev    — a few fictional candidates + one ward issue per ward,
 *                    across the 3 lowest-id wards currently seeded. This
 *                    function's OWN return value (`wardIds`,
 *                    deterministic given the committed geojson) is what
 *                    this script and the specs key off of — never a
 *                    hardcoded ward number.
 *   3. A candidate_fields row for seed-dev's first candidate on its first
 *      ward — a known BASELINE value with sourceType 'curator', so
 *      flag.spec.ts has something real to flag and later see corrected.
 *   4. A curator user (role='curator') scoped to that same first ward, so
 *      flag.spec.ts's second actor (accept + publish) can log in and act
 *      without needing city-wide admin scope.
 *
 * Never writes real candidate/party/curator data — every string here is
 * marked (E2E FIXTURE) the same way seed-dev marks its own rows
 * (FICTIONAL). Refuses to run in production (delegates to seed-dev's own
 * `assertNotProduction` guard).
 *
 * Idempotent: safe to re-run against the same DB (upserts throughout) —
 * useful for local iteration without dropping the test DB each time.
 *
 * ALSO (CLI only, see `main()`): links `dist/data` -> `../data` and
 * `dist/content` -> `../content` after every fresh `npm run build`. This
 * mirrors a step the Dockerfile ALREADY does deliberately (see its own
 * "Runtime file dependencies read straight off disk" comment) — because
 * src/lib/geo.ts / src/lib/pincode.ts / src/i18n/content.ts resolve their
 * data files as `path.join(__dirname, '..', '..', 'data'|'content', ...)`
 * from wherever esbuild places their compiled chunk (`dist/server/chunks/`),
 * which is `dist/data`/`dist/content`, NOT the repo-root `data`/`content`
 * Docker's build stage copies from. The Dockerfile's `COPY data ./dist/data`
 * step is how the real Compose stack gets this right; Playwright's lighter
 * `webServer` (no Docker build stage) needs the equivalent done here, once,
 * before the server starts — discovered by lookup.spec.ts, which 500'd on
 * `wardsForPincode` until this was added.
 */
import { lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/client';
import { seedWards } from './seed-wards';
import { seedDev, assertNotProduction } from './seed-dev';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where `main()` (the CLI entry point below) writes its result, so
 * tests/e2e/support/fixtures.ts can read it back synchronously without
 * re-deriving anything or re-connecting to the DB. Not read by `seedE2E`
 * itself — only by the CLI wrapper — so importing this module from a unit
 * test never touches the filesystem.
 */
export const E2E_FIXTURES_PATH = path.join(__dirname, '..', 'tests', 'e2e', '.fixtures.json');

/**
 * Timestamped (not a fixed literal): src/lib/otp.ts's per-destination
 * cooldown (1/minute, 5/hour) is keyed on this exact address, and a
 * cooldown-skipped `requestOtp` call mints NO new code — flag.spec.ts's
 * curator login would flakily fail if a curator email were reused across
 * back-to-back `npm run seed:e2e` + `playwright test` cycles (a real
 * pattern during local iteration) and land inside the SAME contact's
 * 1-minute window as a just-consumed code from the previous run. A fresh
 * email per seed run makes each run's OTP history start clean.
 */
export const E2E_CURATOR_EMAIL = `e2e-curator-${Date.now()}@example.com`;
export const E2E_FLAG_FIELD_KEY = 'track_record' as const;
export const E2E_FLAG_BASELINE_VALUE_EN = 'Two-term corporator (E2E FIXTURE BASELINE)';

export interface SeedE2EResult {
  /** seed-dev's 3 lowest-id wards, in order — wardIds[0] is this script's "primary" ward. */
  wardIds: number[];
  /** wardIds[0] — used by vote.spec.ts and flag.spec.ts. */
  primaryWardId: number;
  /** Ward issue id on the primary ward (seed-dev seeds exactly one per ward). */
  issueId: number;
  /** seed-dev's first candidate on the primary ward — the flaggable candidate. */
  candidateSlug: string;
  candidateId: number;
  curatorEmail: string;
}

async function ensureFlaggableField(db: Db, candidateId: number): Promise<void> {
  await db
    .insert(schema.candidateFields)
    .values({
      candidateId,
      fieldKey: E2E_FLAG_FIELD_KEY,
      valueEn: E2E_FLAG_BASELINE_VALUE_EN,
      valueKn: null,
      notDeclared: false,
      authoredLang: 'en',
      translationStatus: 'done',
      sourceUrl: 'https://example.org/e2e-fixture-baseline',
      sourceType: 'curator',
      aiExtracted: false,
    })
    .onConflictDoUpdate({
      target: [schema.candidateFields.candidateId, schema.candidateFields.fieldKey],
      set: {
        valueEn: E2E_FLAG_BASELINE_VALUE_EN,
        notDeclared: false,
        sourceType: 'curator',
        sourceUrl: 'https://example.org/e2e-fixture-baseline',
      },
    });
}

async function ensureCurator(db: Db, wardId: number): Promise<void> {
  const [curator] = await db
    .insert(schema.users)
    .values({ email: E2E_CURATOR_EMAIL, role: 'curator', status: 'active' })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { role: 'curator', status: 'active' },
    })
    .returning({ id: schema.users.id });

  const [existingScope] = await db
    .select()
    .from(schema.curatorScopes)
    .where(and(eq(schema.curatorScopes.userId, curator!.id), eq(schema.curatorScopes.wardId, wardId)));

  if (!existingScope) {
    await db.insert(schema.curatorScopes).values({ userId: curator!.id, wardId });
  }
}

export async function seedE2E(db: Db): Promise<SeedE2EResult> {
  assertNotProduction();

  await seedWards(db);
  const devResult = await seedDev(db);
  const primaryWardId = devResult.wardIds[0];
  if (primaryWardId === undefined) {
    throw new Error('seed-e2e: seed-dev returned no ward ids');
  }

  const [issue] = await db
    .select({ id: schema.wardIssues.id })
    .from(schema.wardIssues)
    .where(eq(schema.wardIssues.wardId, primaryWardId))
    .orderBy(schema.wardIssues.id)
    .limit(1);
  if (!issue) {
    throw new Error(`seed-e2e: no ward issue found for primary ward ${primaryWardId}`);
  }

  const candidateSlug = `demo-ward-${primaryWardId}-candidate-1`;
  const [candidate] = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(eq(schema.candidates.slug, candidateSlug));
  if (!candidate) {
    throw new Error(`seed-e2e: expected seed-dev candidate ${candidateSlug} not found`);
  }

  await ensureFlaggableField(db, candidate.id);
  await ensureCurator(db, primaryWardId);

  return {
    wardIds: devResult.wardIds,
    primaryWardId,
    issueId: issue.id,
    candidateSlug,
    candidateId: candidate.id,
    curatorEmail: E2E_CURATOR_EMAIL,
  };
}

/** (Re)creates `dist/{name}` as a symlink to the repo-root `{name}` directory — see this module's header. Assumes `dist/` already exists (ensureDistRuntimeAssets creates it first). */
function linkDistRuntimeDir(name: 'data' | 'content'): void {
  const distDir = path.join(__dirname, '..', 'dist');
  const target = path.join(__dirname, '..', name);
  const link = path.join(distDir, name);

  // `lstatSync` (not `existsSync`, which follows symlinks) also catches a
  // DANGLING symlink left behind by a moved repo checkout — that still
  // needs removing before `symlinkSync` below, which refuses to overwrite
  // an existing path of any kind.
  if (lstatSync(link, { throwIfNoEntry: false })) {
    rmSync(link, { recursive: true, force: true });
  }
  symlinkSync(target, link, 'dir');
}

function ensureDistRuntimeAssets(): void {
  mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
  linkDistRuntimeDir('data');
  linkDistRuntimeDir('content');
}

async function main() {
  assertNotProduction();
  ensureDistRuntimeAssets();

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set. Set it before running, e.g. against the\n' +
        'local stack (deploy/compose.local.yml):\n' +
        'export DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/gba',
    );
    process.exit(1);
  }

  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    // Runs migrations first (idempotent — drizzle's migrator tracks what's
    // already applied) so this single command is enough to take a bare
    // Postgres database to "ready for the e2e suite", matching how
    // playwright.config.ts's README/task-64 report describes the run
    // sequence: migrate -> seed -> `playwright test`.
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });

    const result = await seedE2E(db);
    writeFileSync(E2E_FIXTURES_PATH, JSON.stringify(result, null, 2) + '\n');
    console.log(
      `seed-e2e: primary ward ${result.primaryWardId}, candidate ${result.candidateSlug}, ` +
        `curator ${result.curatorEmail} -> ${E2E_FIXTURES_PATH}`,
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
