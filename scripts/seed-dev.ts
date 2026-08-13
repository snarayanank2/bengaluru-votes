#!/usr/bin/env tsx
/**
 * Local-dev-only fixture data: a handful of obviously-fictional candidates
 * and ward issues layered on top of already-seeded wards, so `astro dev`
 * has something to render. This repo serves a real election, so every
 * name/party here is deliberately unmistakable as fake ("Demo Party A",
 * "(FICTIONAL)" suffixes) — never real candidate or party data.
 *
 * Depends on wards already being seeded (`npm run seed:wards` first): it
 * uses whichever 2-3 ward ids currently exist with the lowest ids, rather
 * than hardcoding specific composite ids, so it stays correct even if the
 * id scheme in seed-wards.ts changes.
 *
 * Refuses to run when NODE_ENV=production — this is dev fixture data only.
 */
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/client';

const DEMO_PARTIES = ['Demo Party A', 'Demo Party B', 'Demo Independent (FICTIONAL)'];

export function assertNotProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'seed-dev: refusing to run with NODE_ENV=production — this seeds fictional demo data, never for prod',
    );
  }
}

export type SeedDevResult = {
  wardIds: number[];
  candidateCount: number;
  issueCount: number;
};

/** Seed a few fake candidates and one ward issue per ward, for local dev. */
export async function seedDev(db: Db): Promise<SeedDevResult> {
  assertNotProduction();

  const wardRows = await db
    .select({ id: schema.wards.id })
    .from(schema.wards)
    .orderBy(schema.wards.id)
    .limit(3);

  if (wardRows.length < 1) {
    throw new Error('seed-dev: no wards found — run `npm run seed:wards` first');
  }

  const wardIds = wardRows.map((w) => w.id);

  let candidateCount = 0;
  let issueCount = 0;

  for (const [i, wardId] of wardIds.entries()) {
    for (let n = 0; n < 2; n++) {
      const slug = `demo-ward-${wardId}-candidate-${n + 1}`;
      await db
        .insert(schema.candidates)
        .values({
          slug,
          wardId,
          nameEn: `Test Candidate ${wardId}-${n + 1} (FICTIONAL)`,
          partyEn: DEMO_PARTIES[(i + n) % DEMO_PARTIES.length],
          status: 'contesting',
        })
        .onConflictDoUpdate({
          target: schema.candidates.slug,
          set: { wardId, status: 'contesting' },
        });
      candidateCount++;
    }

    const issueTitle = `Demo issue for ward ${wardId} (FICTIONAL TEST DATA)`;
    const [existingIssue] = await db
      .select({ id: schema.wardIssues.id })
      .from(schema.wardIssues)
      .where(and(eq(schema.wardIssues.wardId, wardId), eq(schema.wardIssues.titleEn, issueTitle)));

    if (!existingIssue) {
      await db.insert(schema.wardIssues).values({
        wardId,
        titleEn: issueTitle,
        position: 0,
      });
    }
    issueCount++;
  }

  return { wardIds, candidateCount, issueCount };
}

async function main() {
  assertNotProduction();

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
    const result = await seedDev(db);
    console.log(
      `seed-dev: seeded ${result.candidateCount} fictional candidates and ` +
        `ensured ${result.issueCount} ward issues across wards ${result.wardIds.join(', ')}`,
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
