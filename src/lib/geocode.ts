/**
 * Server-side address → ward lookup via the Google Geocoding API.
 *
 * ============================================================================
 * GOOGLE MAPS PLATFORM TERMS CONSTRAINT — READ BEFORE CHANGING THIS FILE
 * ============================================================================
 * Dependency register §6.4 USED to bite here: Google Maps Platform's terms
 * restrict using Google Maps content — geocoding results included — in an
 * application that displays a NON-GOOGLE map, and this platform's map was
 * MapLibre. That is no longer true; rendering moved to the Google Maps JS
 * API on 2026-08-14 and §6.4 is closed.
 *
 * THE RULE BELOW STAYS ANYWAY, ON PRIVACY GROUNDS. It is no longer a
 * licensing requirement, but it is still how this platform avoids holding
 * citizens' locations: geocoding runs SERVER-SIDE and
 * returns A WARD, NEVER COORDINATES — the cache (`geocode_cache`, see
 * src/db/schema.ts) stores normalized-address → ward-ID ONLY, the
 * platform's own derived conclusion, never Google's coordinates or any
 * other part of its response content (architecture.md §13, "cost
 * amplification").
 *
 * Concretely: `lookupWardByAddress` below MUST NOT return a lat/lng to its
 * caller, and MUST NOT persist a lat/lng anywhere (cache row, log line,
 * etc). The Google response's `geometry.location` is read into a local
 * variable, fed straight into `wardForPoint`, and discarded. A future
 * change that "helpfully" returns the point, or logs the raw Google
 * response, breaks this compliance line — don't.
 * ============================================================================
 *
 * A daily geocode budget (architecture.md §13; dependency register §6.5)
 * stops calls once exhausted — see the `budget_exhausted` result below,
 * backed by src/lib/budgets.ts's shared counter.
 *
 * WHAT EXHAUSTING IT NOW COSTS. Until 2026-08-14 `budget_exhausted`
 * degraded the caller to pincode lookup. That path was removed (see the
 * header of src/pages/api/ward-lookup.ts), so this module is now the ONLY
 * way to resolve a ward: exhausting the budget takes ward lookup down
 * rather than making it cheaper. The cap was deliberately left at 2000/day
 * anyway; if that turns out to be wrong, raise GEOCODE_DAILY_BUDGET.
 *
 * VIEWPORT BIAS, NOT A HARD LOCALITY FILTER — this matters for GBA coverage.
 * The GBA (Greater Bengaluru Authority) is the merged corporation: it
 * includes former CMC/TMC areas (e.g. Yelahanka, Bommanahalli,
 * Krishnarajapuram, Rajarajeshwari Nagar, Mahadevapura, Dasarahalli,
 * Byatarayanapura) well beyond the pre-merger "Bengaluru" core. Google's own
 * `locality`/`administrative_area` labeling for addresses in those areas
 * doesn't reliably say "Bengaluru" — a hard `components=locality:Bengaluru`
 * filter would make Google return ZERO_RESULTS for perfectly valid GBA
 * addresses there, which this code would then wrongly cache as
 * `out_of_coverage` forever. So this module only *biases* Google toward the
 * GBA area via the `bounds` viewport parameter (soft — widens/ignores the
 * box if it can't find a match inside it) plus `components=country:IN`
 * (a safe, non-clipping restriction). The actual coverage decision is never
 * Google's locality string — it's `wardForPoint` against the real GBA ward
 * polygons (src/lib/geo.ts), which is what determines `ward` vs
 * `out_of_coverage` below.
 *
 * NOTE (concurrency / cost): a cache miss on the same not-yet-cached address
 * arriving concurrently from two requests will both consume budget and both
 * call Google (no single-flight de-duplication here). Acceptable for this
 * platform's traffic shape; if it ever matters, dedupe in-flight lookups by
 * normalizedAddress before spending budget.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { geocodeCache } from '../db/schema';
import { consumeBudget } from './budgets';
import { loadWardPolygons, wardForPoint } from './geo';

export type WardLookupResult =
  | { kind: 'ward'; wardId: number }
  | { kind: 'out_of_coverage' }
  | { kind: 'ambiguous' }
  | { kind: 'budget_exhausted' }
  | { kind: 'failed' };

/** Daily cap on Google Geocoding API calls (architecture.md §13 / dependency §6.5). */
export const GEOCODE_DAILY_BUDGET = Number(process.env.GEOCODE_DAILY_BUDGET ?? 2000);

const GEOCODE_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

const BENGALURU_RE = /bengaluru|bangalore/i;

/**
 * Padded union bounding box of all 369 features in data/gba.geojson, used as
 * a SOFT `bounds=` viewport bias on Google Geocoding requests (see the
 * module comment above for why this is soft, not a hard locality filter).
 *
 * Derived by computing the union bbox of every Polygon/MultiPolygon
 * coordinate in data/gba.geojson (raw: lat 12.8334905..13.1426196, lng
 * 77.4598797..77.7840639), then padding by ~0.05° on each side so wards at
 * the very edge of the GBA area aren't clipped by the box. Hardcoded here
 * (rather than re-reading the GeoJSON at module load, which src/lib/geo.ts
 * already does) to avoid a second file read on the hot path; regenerate
 * these four numbers if data/gba.geojson's ward boundaries ever change.
 */
const GBA_BOUNDS_SW_LAT = 12.7834;
const GBA_BOUNDS_SW_LNG = 77.4098;
const GBA_BOUNDS_NE_LAT = 13.1927;
const GBA_BOUNDS_NE_LNG = 77.8341;

/**
 * Deterministic normalization used as the geocode_cache primary key: trim,
 * collapse internal whitespace, lowercase, then append ", bengaluru" unless
 * the address already names Bengaluru/Bangalore (case-insensitively). This
 * keeps "MG Road", "  mg   road ", and "MG Road, Bengaluru" all resolving to
 * the same cache row and the same single API call.
 */
export function normalizeAddress(address: string): string {
  const collapsed = address.trim().replace(/\s+/g, ' ').toLowerCase();
  if (BENGALURU_RE.test(collapsed)) return collapsed;
  return `${collapsed}, bengaluru`;
}

type GoogleGeocodeResult = {
  geometry?: { location?: { lat: number; lng: number } };
  partial_match?: boolean;
};

type GoogleGeocodeResponse = {
  status: string;
  results?: GoogleGeocodeResult[];
};

function buildGeocodeUrl(normalizedAddress: string): string {
  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set('address', normalizedAddress);
  // Soft viewport bias toward the GBA area (does not exclude results outside
  // it) + a safe country-only hard restriction. See the module comment and
  // GBA_BOUNDS_* above for why there is no locality/administrative_area
  // filter here.
  url.searchParams.set(
    'bounds',
    `${GBA_BOUNDS_SW_LAT},${GBA_BOUNDS_SW_LNG}|${GBA_BOUNDS_NE_LAT},${GBA_BOUNDS_NE_LNG}`,
  );
  url.searchParams.set('region', 'in');
  url.searchParams.set('components', 'country:IN');
  url.searchParams.set('key', process.env.GOOGLE_GEOCODING_API_KEY ?? '');
  return url.toString();
}

/** Cache a resolved lookup: normalized address -> ward id, or null for "known out of coverage". */
async function cacheResult(normalizedAddress: string, wardId: number | null): Promise<void> {
  await db.insert(geocodeCache).values({ normalizedAddress, wardId }).onConflictDoNothing();
}

/**
 * Resolve a free-text address to a ward. Cache-first, budget-guarded,
 * never surfaces or stores coordinates (see the ToS notice at the top of
 * this file).
 *
 * Order of operations:
 *  1. Normalize (cache key).
 *  2. Cache hit -> return immediately. No API call, no budget spend.
 *  3. Cache miss -> consume one unit of today's geocode budget. Exhausted
 *     -> `budget_exhausted` WITHOUT calling Google (the caller surfaces
 *     this as an outage — there is no cheaper fallback any more).
 *  4. Call Google Geocoding, server-side only. ZERO_RESULTS is cached as
 *     "out of coverage" (null). Multiple results, or a single result Google
 *     itself flags as a `partial_match`, are `ambiguous` and NOT cached
 *     (the answer might change on a retry with a clearer address). A
 *     single confident result is resolved to a ward via in-memory
 *     point-in-polygon (src/lib/geo.ts) and that ward id (or null) is
 *     cached. Any network error or a non-OK/non-ZERO_RESULTS status is
 *     `failed` and NOT cached (transient failures shouldn't calcify into a
 *     wrong cache entry).
 */
export async function lookupWardByAddress(address: string): Promise<WardLookupResult> {
  const normalizedAddress = normalizeAddress(address);

  const [cached] = await db
    .select()
    .from(geocodeCache)
    .where(eq(geocodeCache.normalizedAddress, normalizedAddress));

  if (cached) {
    return cached.wardId !== null ? { kind: 'ward', wardId: cached.wardId } : { kind: 'out_of_coverage' };
  }

  const withinBudget = await consumeBudget('geocode', GEOCODE_DAILY_BUDGET);
  if (!withinBudget) {
    return { kind: 'budget_exhausted' };
  }

  let response: GoogleGeocodeResponse;
  try {
    const res = await fetch(buildGeocodeUrl(normalizedAddress));
    if (!res.ok) {
      return { kind: 'failed' };
    }
    response = (await res.json()) as GoogleGeocodeResponse;
  } catch {
    return { kind: 'failed' };
  }

  if (response.status === 'ZERO_RESULTS') {
    await cacheResult(normalizedAddress, null);
    return { kind: 'out_of_coverage' };
  }

  if (response.status !== 'OK') {
    return { kind: 'failed' };
  }

  const results = response.results ?? [];
  if (results.length !== 1 || results[0].partial_match === true) {
    return { kind: 'ambiguous' };
  }

  const location = results[0].geometry?.location;
  if (!location) {
    return { kind: 'failed' };
  }

  // `lat`/`lng` live only in this local scope: fed to wardForPoint and
  // discarded. Never added to the returned object, never passed to
  // cacheResult. See the ToS notice at the top of this file.
  const { lat, lng } = location;

  // There is no boot-time call to loadWardPolygons() anywhere in this app
  // (Ward.astro deliberately sidesteps it — see its docstring — and no
  // other startup path calls it either), so this is the ONLY production
  // caller of wardForPoint and MUST guarantee its precondition itself.
  // loadWardPolygons() is idempotent (a no-op once loaded — geo.ts's own
  // module-level guard), so this costs nothing on every call after the
  // first and keeps the 3.5MB GeoJSON parse lazy: only the address-geocoding
  // path pays it, on first use, rather than every process eagerly paying it
  // at boot.
  await loadWardPolygons();
  const wardId = wardForPoint(lat, lng);

  await cacheResult(normalizedAddress, wardId);
  return wardId !== null ? { kind: 'ward', wardId } : { kind: 'out_of_coverage' };
}
