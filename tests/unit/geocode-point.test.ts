/**
 * Coverage for `lookupWardByPoint` (src/lib/geocode.ts) — the coordinate
 * input mode behind the home page's "use my current location" control.
 *
 * Its own file rather than a block in geocode.test.ts because the two share
 * nothing: this path never calls Google, never spends the geocode budget and
 * never touches geocode_cache, and those three absences are most of what is
 * worth asserting. The DB connection here exists only to PROVE the absences
 * (budget counter untouched, cache table untouched).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { lookupWardByPoint } from '../../src/lib/geocode';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// The same verified interior point geocode.test.ts uses: inside feature
// ward_369_final.1 (corporation_id 5, ward_id 25 -> wards.id 5025 under the
// corporation_id*1000+ward_id scheme in src/lib/geo.ts).
const INTERIOR_LAT = 12.963397819598583;
const INTERIOR_LNG = 77.51397756422665;
const INTERIOR_WARD_ID = 5025;

// Null Island — a real coordinate pair, outside every GBA ward polygon.
const OUT_OF_COVERAGE_LAT = 0;
const OUT_OF_COVERAGE_LNG = 0;

describe('lookupWardByPoint', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.delete(schema.geocodeCache);
    await db.delete(schema.budgetCounters).where(eq(schema.budgetCounters.kind, 'geocode'));

    // Stubbed so any accidental Google call is a visible failure, not a real
    // network request.
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('resolves a point inside a ward to that ward id', async () => {
    const result = await lookupWardByPoint(INTERIOR_LAT, INTERIOR_LNG);
    expect(result).toEqual({ kind: 'ward', wardId: INTERIOR_WARD_ID });
  });

  it('returns out_of_coverage for a point outside every ward polygon', async () => {
    const result = await lookupWardByPoint(OUT_OF_COVERAGE_LAT, OUT_OF_COVERAGE_LNG);
    expect(result).toEqual({ kind: 'out_of_coverage' });
  });

  // The three reasons this path is worth having at all: it is free, it is
  // instant, and it keeps working when address lookup is `unavailable`.
  it('never calls the Google API', async () => {
    await lookupWardByPoint(INTERIOR_LAT, INTERIOR_LNG);
    await lookupWardByPoint(OUT_OF_COVERAGE_LAT, OUT_OF_COVERAGE_LNG);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('spends no geocode budget, so it still answers when address lookup is exhausted', async () => {
    await lookupWardByPoint(INTERIOR_LAT, INTERIOR_LNG);

    const counters = await db
      .select()
      .from(schema.budgetCounters)
      .where(eq(schema.budgetCounters.kind, 'geocode'));
    expect(counters).toEqual([]);
  });

  // geocode_cache is keyed by normalized address and stores the platform's
  // own ward conclusion. A coordinate lookup has no address to key on, and a
  // citizen's position must never become a stored row — see the compliance
  // notice at the top of src/lib/geocode.ts.
  it('writes no geocode_cache row', async () => {
    await lookupWardByPoint(INTERIOR_LAT, INTERIOR_LNG);
    await lookupWardByPoint(OUT_OF_COVERAGE_LAT, OUT_OF_COVERAGE_LNG);

    const rows = await db.select().from(schema.geocodeCache);
    expect(rows).toEqual([]);
  });

  it('returns only kind/wardId — the position is never echoed back', async () => {
    const result = await lookupWardByPoint(INTERIOR_LAT, INTERIOR_LNG);

    expect(Object.keys(result).sort()).toEqual(['kind', 'wardId']);
    expect(result).not.toHaveProperty('lat');
    expect(result).not.toHaveProperty('lng');
  });

  // Mirrors the regression guard in geocode.test.ts: production has no
  // boot-time loadWardPolygons() call, so every entry point into
  // wardForPoint must guarantee that precondition itself.
  it('resolves even though loadWardPolygons() was never called on this module instance', async () => {
    vi.resetModules();
    vi.doMock('../../src/db/client', () => ({ db }));

    const fresh = await import('../../src/lib/geocode');
    const result = await fresh.lookupWardByPoint(INTERIOR_LAT, INTERIOR_LNG);

    expect(result).toEqual({ kind: 'ward', wardId: INTERIOR_WARD_ID });

    vi.doUnmock('../../src/db/client');
  });
});
