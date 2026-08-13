import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { loadWardPolygons } from '../../src/lib/geo';
import {
  lookupWardByAddress,
  normalizeAddress,
  GEOCODE_DAILY_BUDGET,
} from '../../src/lib/geocode';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// A real interior point of a real GBA ward feature (ward_id 25, corporation_id
// 5, i.e. wards.id 5025 under the corporation_id*1000+ward_id scheme — see
// src/lib/geo.ts / scripts/seed-wards.ts), verified against
// data/gba.geojson to land inside the polygon via wardForPoint. Using a real
// point (rather than stubbing wardForPoint) exercises the genuine
// geo.ts integration end to end.
const INTERIOR_LAT = 12.963397819598583;
const INTERIOR_LNG = 77.51397756422665;
const INTERIOR_WARD_ID = 5025;

// Clearly outside every GBA ward polygon.
const OUT_OF_COVERAGE_LAT = 0;
const OUT_OF_COVERAGE_LNG = 0;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe('lookupWardByAddress', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await loadWardPolygons();
    process.env.GOOGLE_GEOCODING_API_KEY = 'test-key';
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    // This suite owns the 'geocode' budget kind and the whole geocode_cache
    // table exclusively (budgets.test.ts uses different kinds) — safe to
    // reset both fully before every test.
    await db.delete(schema.geocodeCache);
    await db.delete(schema.budgetCounters).where(eq(schema.budgetCounters.kind, 'geocode'));

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('cache hit (ward) skips the API call entirely', async () => {
    const normalized = normalizeAddress('MG Road');
    await db.insert(schema.geocodeCache).values({ normalizedAddress: normalized, wardId: INTERIOR_WARD_ID });

    const result = await lookupWardByAddress('MG Road');

    expect(result).toEqual({ kind: 'ward', wardId: INTERIOR_WARD_ID });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cache hit (null = known out of coverage) skips the API call', async () => {
    const normalized = normalizeAddress('Somewhere Far Away');
    await db.insert(schema.geocodeCache).values({ normalizedAddress: normalized, wardId: null });

    const result = await lookupWardByAddress('Somewhere Far Away');

    expect(result).toEqual({ kind: 'out_of_coverage' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('budget exhausted degrades without calling the API', async () => {
    await db.insert(schema.budgetCounters).values({
      day: todayUtc(),
      kind: 'geocode',
      count: GEOCODE_DAILY_BUDGET,
    });

    const result = await lookupWardByAddress('Brand New Uncached Address');

    expect(result).toEqual({ kind: 'budget_exhausted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds the Google request URL with a soft bounds bias, not a hard locality filter', async () => {
    // Regression guard for the Task 16 review finding: a hard
    // `components=locality:Bengaluru` filter risks ZERO_RESULTS (wrongly
    // cached as out_of_coverage) for legitimate GBA addresses in the merged
    // corporation's non-central former-CMC/TMC areas (Yelahanka,
    // Bommanahalli, Krishnarajapuram, Rajarajeshwari Nagar, Mahadevapura,
    // Dasarahalli, Byatarayanapura) that Google may not label "Bengaluru".
    // The fix biases via `bounds=` (soft viewport) instead of excluding by
    // locality; wardForPoint remains the sole coverage authority.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'OK',
        results: [{ geometry: { location: { lat: INTERIOR_LAT, lng: INTERIOR_LNG } } }],
      }),
    );

    await lookupWardByAddress('Bounds Bias URL Shape Test Address');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain('bounds=');
    expect(requestedUrl).not.toContain('locality:');
    expect(requestedUrl).not.toContain('administrative_area:');
    expect(requestedUrl).toContain('components=country%3AIN');
    expect(requestedUrl).toContain('region=in');
  });

  it('a single OK result resolves to a ward via real point-in-polygon and caches it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'OK',
        results: [{ geometry: { location: { lat: INTERIOR_LAT, lng: INTERIOR_LNG } } }],
      }),
    );

    const result = await lookupWardByAddress('123 Some Street In Ward 25');

    expect(result).toEqual({ kind: 'ward', wardId: INTERIOR_WARD_ID });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const normalized = normalizeAddress('123 Some Street In Ward 25');
    const [cached] = await db
      .select()
      .from(schema.geocodeCache)
      .where(eq(schema.geocodeCache.normalizedAddress, normalized));
    expect(cached).toMatchObject({ normalizedAddress: normalized, wardId: INTERIOR_WARD_ID });
  });

  it('a single OK result outside every ward polygon caches null and returns out_of_coverage', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'OK',
        results: [{ geometry: { location: { lat: OUT_OF_COVERAGE_LAT, lng: OUT_OF_COVERAGE_LNG } } }],
      }),
    );

    const result = await lookupWardByAddress('Somewhere Outside GBA Entirely');

    expect(result).toEqual({ kind: 'out_of_coverage' });

    const normalized = normalizeAddress('Somewhere Outside GBA Entirely');
    const [cached] = await db
      .select()
      .from(schema.geocodeCache)
      .where(eq(schema.geocodeCache.normalizedAddress, normalized));
    expect(cached).toMatchObject({ normalizedAddress: normalized, wardId: null });
  });

  it('ZERO_RESULTS caches null and returns out_of_coverage', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ZERO_RESULTS', results: [] }));

    const result = await lookupWardByAddress('A Nonexistent Address 999999');

    expect(result).toEqual({ kind: 'out_of_coverage' });

    const normalized = normalizeAddress('A Nonexistent Address 999999');
    const [cached] = await db
      .select()
      .from(schema.geocodeCache)
      .where(eq(schema.geocodeCache.normalizedAddress, normalized));
    expect(cached).toMatchObject({ normalizedAddress: normalized, wardId: null });
  });

  it('multiple results are ambiguous and NOT cached', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'OK',
        results: [
          { geometry: { location: { lat: INTERIOR_LAT, lng: INTERIOR_LNG } } },
          { geometry: { location: { lat: INTERIOR_LAT + 0.01, lng: INTERIOR_LNG + 0.01 } } },
        ],
      }),
    );

    const result = await lookupWardByAddress('Main Road');

    expect(result).toEqual({ kind: 'ambiguous' });

    const normalized = normalizeAddress('Main Road');
    const [cached] = await db
      .select()
      .from(schema.geocodeCache)
      .where(eq(schema.geocodeCache.normalizedAddress, normalized));
    expect(cached).toBeUndefined();
  });

  it('a single result flagged partial_match is ambiguous and NOT cached', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'OK',
        results: [
          {
            geometry: { location: { lat: INTERIOR_LAT, lng: INTERIOR_LNG } },
            partial_match: true,
          },
        ],
      }),
    );

    const result = await lookupWardByAddress('Some Vague Partial Address');

    expect(result).toEqual({ kind: 'ambiguous' });

    const normalized = normalizeAddress('Some Vague Partial Address');
    const [cached] = await db
      .select()
      .from(schema.geocodeCache)
      .where(eq(schema.geocodeCache.normalizedAddress, normalized));
    expect(cached).toBeUndefined();
  });

  it('a network error is failed and NOT cached', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const result = await lookupWardByAddress('Address That Errors');

    expect(result).toEqual({ kind: 'failed' });

    const normalized = normalizeAddress('Address That Errors');
    const [cached] = await db
      .select()
      .from(schema.geocodeCache)
      .where(eq(schema.geocodeCache.normalizedAddress, normalized));
    expect(cached).toBeUndefined();
  });

  it('a non-OK HTTP response is failed and NOT cached', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'UNKNOWN_ERROR' }, false));

    const result = await lookupWardByAddress('Address That 500s');

    expect(result).toEqual({ kind: 'failed' });
  });

  it('a non-OK Google status (e.g. REQUEST_DENIED) is failed and NOT cached', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'REQUEST_DENIED', results: [] }));

    const result = await lookupWardByAddress('Address With Bad Key');

    expect(result).toEqual({ kind: 'failed' });
  });

  it('normalizes equivalent addresses to the same cache key: only the first call hits the API', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'OK',
        results: [{ geometry: { location: { lat: INTERIOR_LAT, lng: INTERIOR_LNG } } }],
      }),
    );

    const r1 = await lookupWardByAddress('Test Normalization Street');
    const r2 = await lookupWardByAddress('  test   normalization   street ');
    const r3 = await lookupWardByAddress('Test Normalization Street, Bengaluru');

    expect(r1).toEqual({ kind: 'ward', wardId: INTERIOR_WARD_ID });
    expect(r2).toEqual({ kind: 'ward', wardId: INTERIOR_WARD_ID });
    expect(r3).toEqual({ kind: 'ward', wardId: INTERIOR_WARD_ID });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('normalizeAddress', () => {
    it('trims, collapses whitespace, lowercases, and appends ", bengaluru" when absent', () => {
      expect(normalizeAddress('MG Road')).toBe('mg road, bengaluru');
      expect(normalizeAddress('  mg   road ')).toBe('mg road, bengaluru');
      expect(normalizeAddress('MG Road, Bengaluru')).toBe('mg road, bengaluru');
    });

    it('does not double-append when Bangalore (alternate spelling) is already present', () => {
      expect(normalizeAddress('MG Road, Bangalore')).toBe('mg road, bangalore');
    });
  });

  describe('production regression: no boot-time loadWardPolygons() call exists', () => {
    // Production has NO call site that ever calls loadWardPolygons() (grep
    // src/ — it appears only in geo.ts's own definition and in this test
    // file's/geo.test.ts's setup). This file's beforeAll above calls it
    // explicitly, which masks the real bug: reusing that already-loaded
    // module instance here would prove nothing. vi.resetModules() + a
    // dynamic re-import gives a genuinely fresh, unloaded geo.ts (and the
    // geocode.ts that transitively imports it), reproducing the real
    // production module state on first request.
    it('lookupWardByAddress resolves a ward even though loadWardPolygons() was never called on this module instance', async () => {
      vi.resetModules();
      // Reuse this file's already-open db connection instead of letting the
      // freshly re-imported module graph (geocode.ts -> budgets.ts, and
      // geocode.ts directly) open a second, never-closed postgres pool.
      vi.doMock('../../src/db/client', () => ({ db }));

      const fresh = await import('../../src/lib/geocode');

      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          status: 'OK',
          results: [{ geometry: { location: { lat: INTERIOR_LAT, lng: INTERIOR_LNG } } }],
        }),
      );

      const result = await fresh.lookupWardByAddress('Fresh Unloaded Module Regression Address');

      expect(result).toEqual({ kind: 'ward', wardId: INTERIOR_WARD_ID });

      vi.doUnmock('../../src/db/client');
    });
  });

  describe('Google Maps ToS guard: never a coordinate in or out', () => {
    it('the returned ward result carries only kind/wardId — no lat/lng field', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          status: 'OK',
          results: [{ geometry: { location: { lat: INTERIOR_LAT, lng: INTERIOR_LNG } } }],
        }),
      );

      const result = await lookupWardByAddress('ToS Guard Test Address');

      expect(Object.keys(result).sort()).toEqual(['kind', 'wardId']);
      expect(result).not.toHaveProperty('lat');
      expect(result).not.toHaveProperty('lng');
      expect(result).not.toHaveProperty('location');
      expect(result).not.toHaveProperty('geometry');
    });

    it('the geocode_cache row carries only normalizedAddress/wardId/createdAt — no coordinate columns', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          status: 'OK',
          results: [{ geometry: { location: { lat: INTERIOR_LAT, lng: INTERIOR_LNG } } }],
        }),
      );

      await lookupWardByAddress('ToS Guard Cache Row Test');

      const normalized = normalizeAddress('ToS Guard Cache Row Test');
      const [row] = await db
        .select()
        .from(schema.geocodeCache)
        .where(eq(schema.geocodeCache.normalizedAddress, normalized));

      expect(row).toBeDefined();
      expect(Object.keys(row!).sort()).toEqual(['createdAt', 'normalizedAddress', 'wardId']);
    });
  });
});
