# Google Maps Platform Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MapLibre ward-boundary map with Google Maps Platform, add Places Autocomplete to the ward lookup, add directions link-outs to booth results, and serve ward boundaries from a per-ward URL instead of a 3.5 MB full-collection fetch.

**Architecture:** Astro SSR monolith. The ward map is a vanilla-TS island (`src/islands/`) mounted lazily by `IntersectionObserver`; it fetches one ward's GeoJSON from a new public cached route and draws it over a Google basemap styled by a cloud Map ID. Google credentials reach the browser as data attributes rendered server-side, never as build-time `PUBLIC_*` variables. Every surface degrades to server-rendered markup when the key is absent or the script fails.

**Tech Stack:** TypeScript, Astro 5 (`output: 'server'`), `@googlemaps/js-api-loader`, Drizzle + Postgres, Vitest (jsdom for islands, Astro container API for routes), Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-08-13-google-maps-migration-design.md`

**Credentials:** `docs/gcp.md`. Tasks 4 and 6 cannot be manually verified until §1–3 of that document have produced a browser key and a Map ID. Every automated test in this plan runs without credentials.

## Global Constraints

- **No `PUBLIC_*` env var may carry a Google credential.** Astro inlines `PUBLIC_*` at build time; an image built without it serves a healthy 200 and a broken map with nothing in the logs. Read in server frontmatter, pass as a data attribute.
- **Boolean env vars are compared to the exact string `'true'`** — matches `src/lib/otp.ts:198`.
- **No hex color literals anywhere under `src/` except `src/tokens.css`.** `tests/unit/tokens.test.ts` enforces this. Map colors are read from CSS custom properties at runtime.
- **Map styling rules (`docs/design-system.md` §8):** ward boundary in `--oc-forest` at 2px, `--forest-tint` fill at 30%, no red pins, nothing party-colored, no markers.
- **Islands fail closed.** Any failure leaves the server-rendered fallback markup untouched and never throws into the page.
- **Unset vendor keys degrade to a documented no-op, never an error** (`CLAUDE.md`).
- **Every new UI string needs an `en` key and a generated `kn` counterpart.** `npm run translate -- --check` gates this; `t()` throws on a missing key in dev and test.
- **Tests need `DATABASE_URL`** pointing at a database separate from the app stack's. See `CLAUDE.md` ("Tests need a database"). Islands tests (jsdom) do not.
- **`vitest.config.ts` sets `fileParallelism: false` deliberately.** Do not re-enable parallelism.
- **Nothing is gated by CI.** Run `npm test`, `npm run typecheck`, and `npm run translate -- --check` by hand before any deploy.

## File Structure

**Create:**
- `src/lib/maps-config.ts` — reads the three Google Maps env vars into one typed object. Single source of truth for "is the map on".
- `src/lib/maps-links.ts` — builds Google Maps deep links (directions). Pure, no env, no key.
- `src/pages/ward/[id]/boundary.json.ts` — public GET returning one ward's GeoJSON Feature.
- `tests/routes/ward-boundary.test.ts`
- `tests/unit/maps-config.test.ts`
- `tests/unit/maps-links.test.ts`

**Modify:**
- `src/lib/geo.ts` — add `wardBoundaryFeature(wardId)`; leave everything else alone.
- `src/lib/csp.ts` — add the two Google Maps hosts to the base policy.
- `src/islands/WardMap.ts` — rewrite internals, keep exported shape.
- `src/islands/WardLookup.ts` — add Places Autocomplete.
- `src/islands/BoothLookup.ts` — add directions link to `renderBooths()`.
- `src/features/pages/Ward.astro` — new boundary URL, maps config data attributes, kill-switch gate.
- `src/features/pages/Home.astro` — maps config data attributes on the lookup form.
- `src/features/pages/FindBooth.astro` — directions link in the server-rendered POST branch.
- `src/i18n/en.json`, `src/i18n/kn.json` — one new string.
- `package.json` — drop `maplibre-gl`, add `@googlemaps/js-api-loader`.
- Tests: `tests/unit/ward-map-island.test.ts` (rewrite), `tests/unit/csp.test.ts`, `tests/unit/geo.test.ts`, `tests/routes/ward.test.ts`, `tests/routes/booth-lookup.test.ts`, `tests/unit/booth-lookup-island.test.ts`.

**Task order:** 1 → 2 → 3 → 4 → 5 → 6 → 7. Task 4 consumes Tasks 1–3. Tasks 5 and 6 are independent of each other.

---

### Task 1: Per-ward boundary route

Replaces the island's 3.5 MB full-collection fetch with a ~10 KB per-ward URL.

**Files:**
- Modify: `src/lib/geo.ts` (add one export after `wardBoundaryUrl`, around line 199)
- Create: `src/pages/ward/[id]/boundary.json.ts`
- Test: `tests/unit/geo.test.ts` (add cases), `tests/routes/ward-boundary.test.ts` (create)

**Interfaces:**
- Consumes: `loadWardPolygons()`, `requireLoaded()` from `src/lib/geo.ts`.
- Produces: `wardBoundaryFeature(wardId: number): WardBoundaryFeature | null` and the type `WardBoundaryFeature = { type: 'Feature'; properties: { id: string; wardId: number }; geometry: WardGeometry }`. Task 4 fetches `/ward/<id>/boundary.json` and consumes exactly this JSON shape.

**Why not `/api/`:** `deploy/nginx/conf.d/site.conf:100`'s `location /api/` has no `proxy_cache` and carries `limit_req zone=api burst=60 nodelay`, a zone shared with the write endpoints. At `/ward/<id>/boundary.json` the route falls into the general public location (site.conf:182), which already strips cookies and micro-caches for 60s. No nginx change is needed.

- [ ] **Step 1: Write the failing unit test for `wardBoundaryFeature`**

Append to `tests/unit/geo.test.ts`:

```ts
describe('wardBoundaryFeature', () => {
  it('returns a GeoJSON Feature for a known ward id', async () => {
    await loadWardPolygons();
    const known = wardForPoint(12.9716, 77.5946); // central Bengaluru
    expect(known).not.toBeNull();

    const feature = wardBoundaryFeature(known!);
    expect(feature).not.toBeNull();
    expect(feature!.type).toBe('Feature');
    expect(feature!.properties.wardId).toBe(known);
    expect(typeof feature!.properties.id).toBe('string');
    expect(['Polygon', 'MultiPolygon']).toContain(feature!.geometry.type);
  });

  it('returns null for an unknown ward id', async () => {
    await loadWardPolygons();
    expect(wardBoundaryFeature(999999)).toBeNull();
  });
});
```

Add `wardBoundaryFeature` to that file's existing import from `../../src/lib/geo`.

- [ ] **Step 2: Run it and confirm it fails**

```sh
export DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test
npx vitest run tests/unit/geo.test.ts -t 'wardBoundaryFeature'
```

Expected: FAIL — `wardBoundaryFeature is not a function`.

- [ ] **Step 3: Implement it**

In `src/lib/geo.ts`, export the type alongside the existing internal types and add the function after `wardBoundaryUrl`:

```ts
/**
 * One ward's boundary as a standalone GeoJSON Feature, for
 * `/ward/<id>/boundary.json` (src/pages/ward/[id]/boundary.json.ts) and the
 * map island that fetches it. Returns null for an id with no matching
 * feature — the route turns that into a 404 rather than throwing, unlike
 * `wardBoundaryUrl` above, whose callers already hold a real wards row.
 *
 * `properties` deliberately carries only what the client needs; the raw
 * source properties (corporation_id, ward_id, …) are not forwarded.
 */
export type WardBoundaryFeature = {
  type: 'Feature';
  properties: { id: string; wardId: number };
  geometry: WardGeometry;
};

export function wardBoundaryFeature(wardId: number): WardBoundaryFeature | null {
  const { byId } = requireLoaded();

  const feature = byId.get(wardId);
  if (!feature) return null;

  return {
    type: 'Feature',
    properties: { id: feature.boundaryRef, wardId: feature.wardId },
    geometry: feature.geometry,
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

```sh
npx vitest run tests/unit/geo.test.ts -t 'wardBoundaryFeature'
```

Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing route test**

Create `tests/routes/ward-boundary.test.ts`:

```ts
/**
 * Coverage for src/pages/ward/[id]/boundary.json.ts — the per-ward boundary
 * GeoJSON the map island fetches (spec §4). This route is PUBLIC and CACHED
 * by nginx's general `location /` block, so the cache-safety rule of
 * architecture §5 applies: it must never set a cookie.
 */
import { describe, it, expect } from 'vitest';
import { GET } from '../../src/pages/ward/[id]/boundary.json';
import { loadWardPolygons, wardForPoint } from '../../src/lib/geo';

async function call(id: string): Promise<Response> {
  return (await GET({ params: { id } } as never)) as Response;
}

describe('GET /ward/[id]/boundary.json', () => {
  it('returns a GeoJSON Feature for a real ward', async () => {
    await loadWardPolygons();
    const wardId = wardForPoint(12.9716, 77.5946);
    expect(wardId).not.toBeNull();

    const res = await call(String(wardId));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.type).toBe('Feature');
    expect(body.properties.wardId).toBe(wardId);
    expect(['Polygon', 'MultiPolygon']).toContain(body.geometry.type);
  });

  it('404s an unknown ward id', async () => {
    const res = await call('999999');
    expect(res.status).toBe(404);
  });

  it('404s a non-numeric ward id', async () => {
    const res = await call('not-a-number');
    expect(res.status).toBe(404);
  });

  it('never sets a cookie (public cached route — architecture §5)', async () => {
    await loadWardPolygons();
    const wardId = wardForPoint(12.9716, 77.5946);
    const res = await call(String(wardId));
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

```sh
npx vitest run tests/routes/ward-boundary.test.ts
```

Expected: FAIL — cannot resolve `src/pages/ward/[id]/boundary.json`.

- [ ] **Step 7: Implement the route**

Create `src/pages/ward/[id]/boundary.json.ts`:

```ts
/**
 * GET /ward/{id}/boundary.json — one ward's boundary polygon as GeoJSON,
 * for src/islands/WardMap.ts (spec §4).
 *
 * NOT under /api/ on purpose. `deploy/nginx/conf.d/site.conf`'s
 * `location /api/` has no proxy_cache and carries `limit_req zone=api`, a
 * zone shared with the write endpoints — wrong for an asset fetched during
 * ordinary ward browsing. Here the route falls into the general public
 * `location /`, which already strips the Cookie header on the way in,
 * ignores Set-Cookie on the way back, and micro-caches for 60s.
 *
 * Consequently this route MUST behave like any other public page: it reads
 * no session and sets no cookie. Ward boundaries are public record, so
 * there is nothing to authorize.
 *
 * Not localized — geometry has no language. There is no /kn/ twin.
 */
import type { APIRoute } from 'astro';
import { loadWardPolygons, wardBoundaryFeature } from '../../../lib/geo';

const NOT_FOUND = JSON.stringify({ error: 'not found' });

function notFound(): Response {
  return new Response(NOT_FOUND, {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ params }) => {
  const wardId = Number(params.id);
  if (!Number.isInteger(wardId)) return notFound();

  // Idempotent (geo.ts's own module-level guard) — the 3.5MB parse happens
  // once per process, on whichever path needs it first.
  await loadWardPolygons();

  const feature = wardBoundaryFeature(wardId);
  if (!feature) return notFound();

  return new Response(JSON.stringify(feature), {
    status: 200,
    headers: { 'content-type': 'application/geo+json' },
  });
};
```

Note: `Number('')` is `0` and `Number('  ')` is `0`, both integers — but neither can match a real ward id, so `wardBoundaryFeature` returns null and the route 404s. No extra guard needed.

- [ ] **Step 8: Run the route tests and confirm they pass**

```sh
npx vitest run tests/routes/ward-boundary.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 9: Extend the cache-invariant guard**

`tests/routes/cache-invariant.test.ts` Guard 1 ("public GET cache-invariance",
architecture §5) is the suite that polices exactly this class of route. Add
`/ward/<id>/boundary.json` to the paths it exercises, following the pattern
the existing Guard 1 cases use in that file: render it both anonymously and
with a session cookie present, and assert the two responses are byte-identical
and that neither carries `set-cookie`.

Run it:

```sh
npx vitest run tests/routes/cache-invariant.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```sh
git add src/lib/geo.ts src/pages/ward/\[id\]/boundary.json.ts tests/unit/geo.test.ts tests/routes/ward-boundary.test.ts tests/routes/cache-invariant.test.ts
git commit -m "feat(geo): serve one ward's boundary from its own URL

Replaces the map island's 3.5MB full-collection fetch. Lives outside
/api/ so it lands in nginx's cached public location rather than the
uncached, rate-limited /api/ one."
```

---

### Task 2: Maps configuration and kill switch

One typed reader for the three env vars, so `Ward.astro` and `Home.astro` cannot disagree about whether maps are on.

**Files:**
- Create: `src/lib/maps-config.ts`
- Test: `tests/unit/maps-config.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `mapsConfig(): MapsConfig` where `MapsConfig = { enabled: boolean; browserKey: string; mapId: string }`. Tasks 3, 4 and 5 all call this.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/maps-config.test.ts`:

```ts
/**
 * Coverage for src/lib/maps-config.ts (spec §8). The kill switch and the
 * "unset key degrades to a no-op" rule from CLAUDE.md both live here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mapsConfig } from '../../src/lib/maps-config';

const KEYS = ['MAPS_ENABLED', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAPS_MAP_ID'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe('mapsConfig', () => {
  it('is disabled when nothing is set', () => {
    expect(mapsConfig()).toEqual({ enabled: false, browserKey: '', mapId: '' });
  });

  it('is disabled when the key is set but MAPS_ENABLED is not', () => {
    process.env.GOOGLE_MAPS_BROWSER_KEY = 'k';
    expect(mapsConfig().enabled).toBe(false);
  });

  it('is disabled when MAPS_ENABLED is true but the key is missing', () => {
    process.env.MAPS_ENABLED = 'true';
    expect(mapsConfig().enabled).toBe(false);
  });

  it('is enabled only when MAPS_ENABLED is exactly "true" and a key is present', () => {
    process.env.MAPS_ENABLED = 'true';
    process.env.GOOGLE_MAPS_BROWSER_KEY = 'k';
    process.env.GOOGLE_MAPS_MAP_ID = 'm';
    expect(mapsConfig()).toEqual({ enabled: true, browserKey: 'k', mapId: 'm' });
  });

  it('treats any other MAPS_ENABLED value as off', () => {
    process.env.GOOGLE_MAPS_BROWSER_KEY = 'k';
    for (const v of ['1', 'yes', 'TRUE', 'on', '']) {
      process.env.MAPS_ENABLED = v;
      expect(mapsConfig().enabled).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```sh
npx vitest run tests/unit/maps-config.test.ts
```

Expected: FAIL — cannot resolve `src/lib/maps-config`.

- [ ] **Step 3: Implement it**

Create `src/lib/maps-config.ts`:

```ts
/**
 * The three Google Maps Platform settings, read once per render (spec §8).
 *
 * BUILD-TIME TRAP — do not "simplify" these into PUBLIC_* variables.
 * Astro inlines `PUBLIC_*` at build time. An image built without the value
 * would serve every GET a healthy 200 and a silently broken map, with
 * nothing in `docker compose ps`, the healthcheck, or the logs to say so —
 * the same failure mode CLAUDE.md documents for SITE_ORIGIN. These are read
 * in server frontmatter and handed to the island as data attributes, which
 * keeps them runtime config a container restart can change.
 *
 * `enabled` requires BOTH the kill switch and a key: an unset key degrades
 * to a documented no-op rather than an error (CLAUDE.md), and MAPS_ENABLED
 * lets client-side map spend be shed without a rebuild when a budget alert
 * fires (docs/gcp.md §5 — a GCP quota cap breaks rather than degrades).
 *
 * `=== 'true'` exactly, matching the OTP_TEST_SINK convention in
 * src/lib/otp.ts.
 */
export interface MapsConfig {
  enabled: boolean;
  browserKey: string;
  mapId: string;
}

export function mapsConfig(): MapsConfig {
  const browserKey = process.env.GOOGLE_MAPS_BROWSER_KEY ?? '';
  const mapId = process.env.GOOGLE_MAPS_MAP_ID ?? '';

  return {
    enabled: process.env.MAPS_ENABLED === 'true' && browserKey !== '',
    browserKey,
    mapId,
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

```sh
npx vitest run tests/unit/maps-config.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```sh
git add src/lib/maps-config.ts tests/unit/maps-config.test.ts
git commit -m "feat(maps): add the maps config reader and MAPS_ENABLED kill switch"
```

---

### Task 3: CSP hosts and Ward.astro wiring

Adds the Google Maps hosts to the base policy and hands the island its config. After this task the ward page still renders the MapLibre island — Task 4 swaps it — but the page is ready for it.

**Files:**
- Modify: `src/lib/csp.ts:106-129` (the `buildCsp` directive list and its docstring)
- Modify: `src/features/pages/Ward.astro:65` and `:100`
- Test: `tests/unit/csp.test.ts`, `tests/routes/ward.test.ts`

**Interfaces:**
- Consumes: `mapsConfig()` from Task 2.
- Produces: the map container's data attributes, which Task 4's island reads: `data-boundary-url`, `data-maps-key`, `data-maps-map-id`. The container is rendered **only when `mapsConfig().enabled`**; otherwise the fallback `<p>` renders alone with no `data-ward-map` attribute, so no island mounts.

- [ ] **Step 1: Write the failing CSP test**

Add to `tests/unit/csp.test.ts`:

```ts
describe('Google Maps hosts (spec §8)', () => {
  const MAPS_HOSTS = ['https://maps.googleapis.com', 'https://maps.gstatic.com'];

  it.each(['script-src', 'connect-src', 'img-src'])('allows the maps hosts in %s', (directive) => {
    const csp = buildCsp('n0nce', '/ward/1');
    const found = csp.split('; ').find((d) => d.startsWith(`${directive} `));
    expect(found).toBeDefined();
    for (const host of MAPS_HOSTS) expect(found).toContain(host);
  });

  it('keeps the maps hosts on every route, not just the ward page', () => {
    for (const path of ['/', '/kn/', '/voting-guide', '/partner-with-us']) {
      expect(buildCsp('n0nce', path)).toContain('https://maps.googleapis.com');
    }
  });

  it('still adds the reCAPTCHA hosts on /partner-with-us only', () => {
    expect(buildCsp('n0nce', '/partner-with-us')).toContain('https://www.gstatic.com');
    expect(buildCsp('n0nce', '/ward/1')).not.toContain('https://www.gstatic.com');
  });

  it('still forbids unsafe-inline in script-src', () => {
    expect(buildCsp('n0nce', '/ward/1')).not.toContain("'unsafe-inline' ");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```sh
npx vitest run tests/unit/csp.test.ts -t 'Google Maps hosts'
```

Expected: FAIL — maps hosts absent from all three directives.

- [ ] **Step 3: Add the hosts**

In `src/lib/csp.ts`, inside `buildCsp`, above the `directives` array:

```ts
  // Google Maps Platform (spec §8): the ward-boundary map
  // (src/islands/WardMap.ts) and the ward-lookup Places Autocomplete
  // (src/islands/WardLookup.ts). These live in the BASE policy rather than
  // a path-scoped extension like the reCAPTCHA one below, because the two
  // consumers sit on different routes (/ward/* and /) and maintaining two
  // more path matchers costs more than it protects.
  //
  // `script-src`: @googlemaps/js-api-loader injects a <script src=…> at
  // runtime. A script element whose src matches an allowlisted host does
  // not additionally need the nonce, so the nonce-only policy still holds
  // for inline script.
  const MAPS_HOSTS = ['https://maps.googleapis.com', 'https://maps.gstatic.com'] as const;
```

Then add `...MAPS_HOSTS` to `scriptSrcHosts`' initializer, and append the two hosts to the `img-src` and `connect-src` directive strings:

```ts
  const scriptSrcHosts = ['https://www.googletagmanager.com', ...MAPS_HOSTS];
```

```ts
    `img-src 'self' data: https://www.googletagmanager.com https://*.google-analytics.com ${MAPS_HOSTS.join(' ')}`,
```

```ts
    `connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com ${MAPS_HOSTS.join(' ')}`,
```

- [ ] **Step 4: Update the `worker-src` comment**

In `src/lib/csp.ts`'s docstring, replace the MapLibre-specific explanation (lines ~78-84) with:

```
 * `worker-src 'self' blob:`: the Google Maps JavaScript API
 * (src/islands/WardMap.ts, the ward boundary map) constructs workers from
 * `blob:` URLs internally — without this the map silently fails and the
 * container keeps its server-rendered fallback text. This directive
 * predates the Google migration (MapLibre needed it for the same reason)
 * and is unchanged by it.
```

- [ ] **Step 5: Run the CSP tests and confirm they pass**

```sh
npx vitest run tests/unit/csp.test.ts
```

Expected: PASS, including the pre-existing reCAPTCHA and nonce cases.

- [ ] **Step 6: Write the failing Ward.astro test**

Add to `tests/routes/ward.test.ts`:

```ts
describe('map container (spec §3, §8)', () => {
  const MAPS_KEYS = ['MAPS_ENABLED', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAPS_MAP_ID'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(MAPS_KEYS.map((k) => [k, process.env[k]]));
  });

  afterEach(() => {
    for (const k of MAPS_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  it('renders the map container with its config when maps are enabled', async () => {
    process.env.MAPS_ENABLED = 'true';
    process.env.GOOGLE_MAPS_BROWSER_KEY = 'test-browser-key';
    process.env.GOOGLE_MAPS_MAP_ID = 'test-map-id';

    const html = normalize(await renderWard('en', WARD.id));

    expect(html).toContain('data-ward-map');
    expect(html).toContain(`data-boundary-url="/ward/${WARD.id}/boundary.json"`);
    expect(html).toContain('data-maps-key="test-browser-key"');
    expect(html).toContain('data-maps-map-id="test-map-id"');
  });

  it('renders only the fallback and no island hook when maps are disabled', async () => {
    delete process.env.MAPS_ENABLED;
    delete process.env.GOOGLE_MAPS_BROWSER_KEY;

    const html = normalize(await renderWard('en', WARD.id));

    expect(html).not.toContain('data-ward-map');
    expect(html).not.toContain('data-maps-key');
    expect(html).toContain(t('en', 'ward.map.fallback'));
  });

  it('never leaks the browser key when maps are disabled', async () => {
    delete process.env.MAPS_ENABLED;
    process.env.GOOGLE_MAPS_BROWSER_KEY = 'secret-key';

    expect(normalize(await renderWard('en', WARD.id))).not.toContain('secret-key');
  });
});
```

Reuse whatever render helper that file already defines; if it renders inline, extract a `renderWard(lang, id)` helper first and leave the existing cases calling it unchanged.

- [ ] **Step 7: Run it and confirm it fails**

```sh
npx vitest run tests/routes/ward.test.ts -t 'map container'
```

Expected: FAIL — `data-boundary-url` still points at `/data/gba.geojson#…`.

- [ ] **Step 8: Wire Ward.astro**

Add the import and config near the other frontmatter imports:

```ts
import { mapsConfig } from '../../lib/maps-config';
```

Replace line 65's `boundaryUrl` with:

```ts
// Boundary geometry now comes from this ward's own URL rather than the
// 3.5MB full collection (spec §4). `wards.boundaryRef` is still the source
// of truth for which feature this is — the route resolves it server-side —
// so this page no longer formats a fragment URL from the row.
const maps = mapsConfig();
const boundaryUrl = ward ? `/ward/${wardId}/boundary.json` : null;
```

Replace the map container markup (line ~100) with:

```astro
        <section aria-label={t(lang, 'ward.map.label')}>
          {maps.enabled ? (
            <div
              class="map-container"
              data-ward-map
              data-boundary-url={boundaryUrl}
              data-ward-id={wardId}
              data-maps-key={maps.browserKey}
              data-maps-map-id={maps.mapId}
            >
              <p class="map-fallback">{t(lang, 'ward.map.fallback')}</p>
            </div>
          ) : (
            <div class="map-container">
              <p class="map-fallback">{t(lang, 'ward.map.fallback')}</p>
            </div>
          )}
        </section>
```

Update the component docstring's "Boundary map URL" paragraph to describe the new route and the kill switch.

- [ ] **Step 9: Run the ward tests and confirm they pass**

```sh
npx vitest run tests/routes/ward.test.ts
```

Expected: PASS, including every pre-existing case in that file.

- [ ] **Step 10: Commit**

```sh
git add src/lib/csp.ts src/features/pages/Ward.astro tests/unit/csp.test.ts tests/routes/ward.test.ts
git commit -m "feat(maps): allow Google Maps hosts in CSP, wire ward map config

The map container now renders only when MAPS_ENABLED is on and a browser
key is present, and points at the per-ward boundary route."
```

---

### Task 4: Rewrite the map island

The largest task. Keeps `initWardMap` / `mountWardMap` exported so `Ward.astro`'s script block is untouched.

**Files:**
- Modify: `src/islands/WardMap.ts` (full internal rewrite)
- Modify: `package.json`
- Test: `tests/unit/ward-map-island.test.ts` (rewrite)

**Interfaces:**
- Consumes: `/ward/<id>/boundary.json` returning `WardBoundaryFeature` (Task 1); the container data attributes from Task 3.
- Produces: `initWardMap(root?: ParentNode): void`, `mountWardMap(container: HTMLElement): Promise<void>`, and the pure helpers `computeFeatureBounds(feature)` and `readMapColors(root?)`. `parseBoundaryUrl` and `findWardFeature` are **deleted** — there is no fragment and no collection to search.

**Failure-closed contract (spec §5) — the crux of this task.** The container's server-rendered fallback `<p>` must survive every failure. Two Google-specific shapes the old try/catch did not cover:
1. The loader promise rejects (script blocked, offline, CSP violation).
2. The script loads and *then* `window.gm_authFailure` fires — bad key, referrer mismatch, billing off. This is asynchronous and arrives after `mountWardMap` has already returned.

So: **clear the container only after a `google.maps.Map` object exists**, and have the `gm_authFailure` handler restore the fallback if it has already been cleared. `gm_authFailure` is a global single-slot callback — install it once, idempotently.

- [ ] **Step 1: Swap the dependency**

```sh
npm uninstall maplibre-gl
npm install @googlemaps/js-api-loader
npm install --save-dev @types/google.maps
```

- [ ] **Step 2: Write the failing island tests**

Replace `tests/unit/ward-map-island.test.ts` entirely:

```ts
// @vitest-environment jsdom
/**
 * Coverage for src/islands/WardMap.ts (spec §5).
 *
 * A real Google map needs network and a WebGL canvas jsdom does not
 * provide, so this file exercises the pure helpers directly and mocks
 * @googlemaps/js-api-loader for the wiring. The cases that matter most are
 * the failure ones: the container's server-rendered fallback must survive
 * every way this island can fail.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { loadMock, MapMock, addGeoJsonMock, fitBoundsMock } = vi.hoisted(() => {
  const addGeoJsonMock = vi.fn();
  const fitBoundsMock = vi.fn();
  const MapMock = vi.fn().mockImplementation(() => ({
    data: { addGeoJson: addGeoJsonMock, setStyle: vi.fn() },
    fitBounds: fitBoundsMock,
  }));
  const loadMock = vi.fn();
  return { loadMock, MapMock, addGeoJsonMock, fitBoundsMock };
});

vi.mock('@googlemaps/js-api-loader', () => ({
  Loader: vi.fn().mockImplementation(() => ({ importLibrary: loadMock })),
}));

import {
  computeFeatureBounds,
  readMapColors,
  mountWardMap,
  initWardMap,
  type WardBoundaryFeatureLike,
} from '../../src/islands/WardMap';

const FEATURE: WardBoundaryFeatureLike = {
  type: 'Feature',
  properties: { id: 'ward_369_final.1', wardId: 1001 },
  geometry: { type: 'Polygon', coordinates: [[[77.5, 12.9], [77.6, 12.9], [77.6, 13.0], [77.5, 13.0], [77.5, 12.9]]] },
};

const FALLBACK = 'Map of ward boundary';

function makeContainer(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-ward-map', '');
  el.dataset.boundaryUrl = '/ward/1001/boundary.json';
  el.dataset.mapsKey = 'test-key';
  el.dataset.mapsMapId = 'test-map-id';
  for (const [k, v] of Object.entries(attrs)) el.dataset[k] = v;
  el.innerHTML = `<p class="map-fallback">${FALLBACK}</p>`;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  loadMock.mockResolvedValue({ Map: MapMock, LatLngBounds: class { extend() { return this; } } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => FEATURE }));
  delete (window as unknown as Record<string, unknown>).gm_authFailure;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('computeFeatureBounds (pure)', () => {
  it('returns the bbox of a Polygon', () => {
    expect(computeFeatureBounds(FEATURE)).toEqual([[77.5, 12.9], [77.6, 13.0]]);
  });

  it('spans every polygon of a MultiPolygon', () => {
    const multi: WardBoundaryFeatureLike = {
      ...FEATURE,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[77.5, 12.9], [77.6, 12.9], [77.5, 12.9]]],
          [[[77.7, 13.1], [77.8, 13.2], [77.7, 13.1]]],
        ],
      },
    };
    expect(computeFeatureBounds(multi)).toEqual([[77.5, 12.9], [77.8, 13.2]]);
  });
});

describe('readMapColors (pure)', () => {
  it('falls back to neutral named colors when tokens are absent', () => {
    const colors = readMapColors(document.documentElement);
    expect(colors.fill).toBeTruthy();
    expect(colors.line).toBeTruthy();
    expect(colors.fill).not.toMatch(/#|red|crimson/i);
    expect(colors.line).not.toMatch(/#|red|crimson/i);
  });
});

describe('mountWardMap — success', () => {
  it('builds a map and draws the boundary', async () => {
    const container = makeContainer();
    await mountWardMap(container);

    expect(MapMock).toHaveBeenCalledTimes(1);
    expect(addGeoJsonMock).toHaveBeenCalledWith(FEATURE);
    expect(container.textContent).not.toContain(FALLBACK);
  });

  it('passes the Map ID from the container through to the map', async () => {
    await mountWardMap(makeContainer());
    expect(MapMock.mock.calls[0][1]).toMatchObject({ mapId: 'test-map-id' });
  });
});

describe('mountWardMap — failure closed (spec §5)', () => {
  it('leaves the fallback when data-boundary-url is missing', async () => {
    const container = makeContainer();
    delete container.dataset.boundaryUrl;
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('leaves the fallback when data-maps-key is missing', async () => {
    const container = makeContainer();
    delete container.dataset.mapsKey;
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('leaves the fallback when the boundary fetch is non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const container = makeContainer();
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('leaves the fallback when the boundary fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const container = makeContainer();
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
  });

  it('leaves the fallback when the Google loader rejects', async () => {
    loadMock.mockRejectedValue(new Error('script blocked by CSP'));
    const container = makeContainer();
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('restores the fallback when gm_authFailure fires after a successful mount', async () => {
    const container = makeContainer();
    await mountWardMap(container);
    expect(container.textContent).not.toContain(FALLBACK);

    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();

    expect(container.textContent).toContain(FALLBACK);
  });

  it('installs exactly one gm_authFailure handler across multiple mounts', async () => {
    await mountWardMap(makeContainer());
    const first = (window as unknown as Record<string, unknown>).gm_authFailure;
    await mountWardMap(makeContainer());
    expect((window as unknown as Record<string, unknown>).gm_authFailure).toBe(first);
  });
});

describe('initWardMap', () => {
  it('does nothing when no container is present', () => {
    expect(() => initWardMap(document)).not.toThrow();
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('mounts immediately when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    makeContainer();
    initWardMap(document);
    await vi.waitFor(() => expect(MapMock).toHaveBeenCalled());
  });

  it('defers the mount until the container intersects', async () => {
    const observe = vi.fn();
    let trigger: ((entries: unknown[]) => void) | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: unknown[]) => void) { trigger = cb; }
        observe = observe;
        unobserve = vi.fn();
      },
    );

    const container = makeContainer();
    initWardMap(document);
    expect(observe).toHaveBeenCalledWith(container);
    expect(MapMock).not.toHaveBeenCalled();

    trigger!([{ isIntersecting: true, target: container }]);
    await vi.waitFor(() => expect(MapMock).toHaveBeenCalled());
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```sh
npx vitest run tests/unit/ward-map-island.test.ts
```

Expected: FAIL — the module still imports `maplibre-gl` and exports `parseBoundaryUrl`.

- [ ] **Step 4: Rewrite the island**

Replace `src/islands/WardMap.ts` entirely:

```ts
/**
 * WardMap — the ward boundary map (IA §3.2), on the Google Maps JavaScript
 * API. Migrated from MapLibre 2026-08-13; design
 * docs/superpowers/specs/2026-08-13-google-maps-migration-design.md.
 *
 * The basemap is styled by a cloud Map ID (docs/gcp.md §4), NOT in code —
 * that is what satisfies design-system.md §8's "desaturated gray basemap".
 * The ward polygon itself is still drawn here, and its colors are still
 * read off the page's CSS custom properties at init time (`readMapColors`)
 * rather than hardcoded: tests/unit/tokens.test.ts bans hex literals
 * anywhere under src/ except tokens.css. No markers or pins are ever added,
 * and nothing here is keyed to party/candidate data.
 *
 * FAILING CLOSED IS THE CONTRACT. The container carries a server-rendered
 * fallback (`ward.map.fallback` — Ward.astro). Every failure path below
 * leaves it in place, and the container is cleared ONLY once a real map
 * object exists. A working map is a bonus; the ward page never depends on
 * one. Two Google-specific failures the pre-migration MapLibre code did not
 * have to handle:
 *
 *   - the loader promise rejecting (script blocked, offline, CSP), and
 *   - `window.gm_authFailure`, which fires AFTER a successful script load
 *     when the key is rejected (bad referrer, billing off). It arrives
 *     asynchronously, long after `mountWardMap` has returned, so it has to
 *     put the fallback BACK.
 *
 * `gm_authFailure` is a GLOBAL, SINGLE-SLOT window callback — not per-map.
 * It is installed once here, idempotently, and every mounted container
 * registers itself with that one handler. A second map island added later
 * must reuse this registry rather than assigning `window.gm_authFailure`
 * again, or it will silently clobber this one.
 *
 * The key and Map ID arrive as data attributes from server frontmatter
 * (Ward.astro -> src/lib/maps-config.ts), never as build-time PUBLIC_*
 * variables — see that module's header for why.
 */
import { Loader } from '@googlemaps/js-api-loader';

// ---------------------------------------------------------------------------
// Minimal GeoJSON shapes — mirrors `WardBoundaryFeature` in src/lib/geo.ts,
// which is what /ward/<id>/boundary.json returns. Declared structurally here
// rather than imported so this client bundle never pulls in the server's geo
// module (and, through it, node:fs).
// ---------------------------------------------------------------------------

type Position = [number, number, ...number[]];

export interface WardBoundaryFeatureLike {
  type: 'Feature';
  properties: { id: string; wardId: number };
  geometry: { type: string; coordinates: unknown };
}

type LngLatBounds = [[number, number], [number, number]];

// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit testing (no Google API, no network).
// ---------------------------------------------------------------------------

/** Recursively visits every [lng, lat, ...] position in a Polygon/MultiPolygon tree. */
function visitPositions(coords: unknown, visit: (pos: Position) => void): void {
  if (!Array.isArray(coords) || coords.length === 0) return;
  if (typeof coords[0] === 'number') {
    visit(coords as Position);
    return;
  }
  for (const child of coords as unknown[]) visitPositions(child, visit);
}

/** Bounding box `[[minLng, minLat], [maxLng, maxLat]]` for a Polygon or MultiPolygon. */
export function computeFeatureBounds(feature: WardBoundaryFeatureLike): LngLatBounds {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  visitPositions(feature.geometry.coordinates, ([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export interface WardMapColors {
  fill: string;
  line: string;
}

/**
 * Reads the two polygon colors off `root`'s computed CSS custom properties
 * (design-system.md §8: `--forest-tint` fill, `--oc-forest` boundary line).
 * Never hardcodes a hex value; the named-color fallbacks are reached only if
 * tokens.css failed to load and are deliberately neutral — no red, no party
 * hue. The basemap background is no longer read here: the cloud Map ID owns
 * it now, where `buildBaseStyle`'s empty background layer used to.
 */
export function readMapColors(root: HTMLElement = document.documentElement): WardMapColors {
  const style = getComputedStyle(root);
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;

  return {
    fill: read('--forest-tint', 'gray'),
    line: read('--oc-forest', 'darkslategray'),
  };
}

// ---------------------------------------------------------------------------
// gm_authFailure — one global handler, many containers.
// ---------------------------------------------------------------------------

/** Containers whose fallback must be restored if Google rejects the key. */
const mounted = new Map<HTMLElement, string>();
let authFailureInstalled = false;

function restoreFallback(container: HTMLElement, html: string): void {
  container.innerHTML = html;
}

function installAuthFailureHandler(): void {
  if (authFailureInstalled) return;
  authFailureInstalled = true;

  // Global and single-slot by Google's design — see the file header.
  (window as unknown as { gm_authFailure: () => void }).gm_authFailure = () => {
    for (const [container, fallbackHtml] of mounted) restoreFallback(container, fallbackHtml);
    mounted.clear();
  };
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

/**
 * Fetches this ward's boundary, loads the Maps JS API, and mounts a map into
 * `container`. Any failure — missing attribute, network error, non-2xx, bad
 * JSON, loader rejection — returns without touching `container`, leaving its
 * server-rendered fallback exactly as the server sent it. Exported for
 * direct testing.
 */
export async function mountWardMap(container: HTMLElement): Promise<void> {
  const boundaryUrl = container.dataset.boundaryUrl;
  const apiKey = container.dataset.mapsKey;
  const mapId = container.dataset.mapsMapId;
  if (!boundaryUrl || !apiKey) return;

  let feature: WardBoundaryFeatureLike;
  try {
    const res = await fetch(boundaryUrl);
    if (!res.ok) return;
    feature = (await res.json()) as WardBoundaryFeatureLike;
  } catch {
    return;
  }

  if (feature?.type !== 'Feature' || !feature.geometry) return;

  let maps: google.maps.MapsLibrary;
  try {
    const loader = new Loader({ apiKey, version: 'weekly' });
    maps = (await loader.importLibrary('maps')) as google.maps.MapsLibrary;
  } catch {
    // Script blocked, offline, or refused by CSP. Fallback stays.
    return;
  }

  const colors = readMapColors();
  const [[minLng, minLat], [maxLng, maxLat]] = computeFeatureBounds(feature);

  // Everything that can fail has now succeeded — only here is it safe to
  // take the container over. Keep the fallback markup so gm_authFailure can
  // put it back (see the file header).
  const fallbackHtml = container.innerHTML;
  container.textContent = '';

  const map = new maps.Map(container, {
    mapId: mapId || undefined,
    disableDefaultUI: true,
    clickableIcons: false,
  });

  mounted.set(container, fallbackHtml);
  installAuthFailureHandler();

  map.data.addGeoJson(feature as unknown as object);
  map.data.setStyle({
    fillColor: colors.fill,
    fillOpacity: 0.3,
    strokeColor: colors.line,
    strokeWeight: 2,
    clickable: false,
  });

  map.fitBounds(
    new google.maps.LatLngBounds({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng }),
    24,
  );
}

/**
 * Wires every `[data-ward-map]` container under `root`. Safe to call when
 * none is present (does nothing) — which is exactly what happens when
 * MAPS_ENABLED is off, since Ward.astro then renders the fallback without
 * the `data-ward-map` hook.
 *
 * Lazy: the map is constructed only once its container scrolls into view.
 * Falls back to mounting immediately where IntersectionObserver is absent.
 */
export function initWardMap(root: ParentNode = document): void {
  const containers = Array.from(root.querySelectorAll<HTMLElement>('[data-ward-map]'));
  if (containers.length === 0) return;

  if (typeof IntersectionObserver === 'undefined') {
    for (const container of containers) void mountWardMap(container);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      void mountWardMap(entry.target as HTMLElement);
    }
  });

  for (const container of containers) observer.observe(container);
}
```

- [ ] **Step 5: Run the island tests and confirm they pass**

```sh
npx vitest run tests/unit/ward-map-island.test.ts
```

Expected: PASS. If the `LatLngBounds` mock trips the `fitBounds` call, extend the mock returned by `loadMock` rather than weakening the assertion — the failure cases are the point of this suite.

- [ ] **Step 6: Confirm MapLibre is gone**

```sh
grep -rn "maplibre" --include="*.ts" --include="*.astro" --include="*.json" . | grep -v node_modules | grep -v docs/
```

Expected: no output outside `docs/` (the historical design docs may still mention it). If `package-lock.json` still lists it, re-run `npm install`.

- [ ] **Step 7: Typecheck**

```sh
npm run typecheck
```

Expected: clean. `@types/google.maps` supplies the `google.maps.*` namespace.

- [ ] **Step 8: Commit**

```sh
git add src/islands/WardMap.ts tests/unit/ward-map-island.test.ts package.json package-lock.json
git commit -m "feat(maps): render the ward boundary on Google Maps

Drops maplibre-gl. Basemap styling moves to a cloud Map ID; the polygon
is still drawn from CSS custom properties. Adds handling for the two
Google-specific failure shapes — loader rejection and the asynchronous,
global gm_authFailure — both of which must leave the server-rendered
fallback intact."
```

---

### Task 5: Places Autocomplete on the ward lookup

**Files:**
- Modify: `src/features/pages/Home.astro` (the `[data-ward-lookup]` form)
- Modify: `src/islands/WardLookup.ts`
- Test: `tests/unit/ward-lookup-island.test.ts`, `tests/routes/home.test.ts`

**Interfaces:**
- Consumes: `mapsConfig()` (Task 2); the CSP hosts (Task 3).
- Produces: nothing other tasks depend on.

**VERIFY THE WIDGET BEFORE WRITING CODE — this determines which SKU
`docs/gcp.md` §2 must enable, and enabling the wrong one is exactly the
failure that document warns about.** Google ships two autocomplete surfaces:

- `google.maps.places.Autocomplete` — the older widget that binds to an
  existing `<input>`. Preserves this island's progressive-enhancement story
  exactly (the input is a plain text field until the script attaches), which
  is why the code below uses it.
- `google.maps.places.PlaceAutocompleteElement` — the newer custom element,
  which **replaces** the input rather than binding to it. Adopting it changes
  `Home.astro`'s markup and the no-JS story, so it is not a drop-in.

Confirm against current Google documentation which is available, whether the
older widget is still supported, and which Places SKU each requires. Then
make `docs/gcp.md` §2 agree. If the newer element is required, stop and
re-open the design — the markup change is out of this task's scope.

**Two invariants that must not break:**
1. The 6-digit pincode branch runs first and never reaches autocomplete.
2. On selection the island posts `{ address: <formatted_address> }` — **never coordinates**. The server still geocodes and still resolves the ward via `wardForPoint`, which is what keeps `geocode_cache` coordinate-free (`src/lib/geocode.ts` header) and keeps one resolution path.

- [ ] **Step 1: Write the failing island test**

Add to `tests/unit/ward-lookup-island.test.ts`:

```ts
describe('Places Autocomplete (spec §6)', () => {
  it('still posts a pincode body for a 6-digit query, without autocomplete', async () => {
    const { form, input, fetchMock } = setupLookupForm({ mapsKey: 'test-key' });
    input.value = '560001';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ pincode: '560001' });
    expect(body.address).toBeUndefined();
  });

  it('posts an address body, never coordinates, for a free-text query', async () => {
    const { form, input, fetchMock } = setupLookupForm({ mapsKey: 'test-key' });
    input.value = 'MG Road';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ address: 'MG Road' });
    expect(body).not.toHaveProperty('lat');
    expect(body).not.toHaveProperty('lng');
  });

  it('does not attach autocomplete when no maps key is present', async () => {
    const { form } = setupLookupForm({});
    expect(form.dataset.mapsKey).toBeUndefined();
    // The form still works — this is the degraded path, which is the
    // plain text input the form already was.
  });
});
```

Follow whatever fixture helper that file already uses; if it has none, write `setupLookupForm(opts)` to build the same markup `Home.astro` renders (`[data-ward-lookup]`, `input[name="query"]`, `[data-ward-result]`, the `data-msg-*` attributes) and stub `fetch`.

- [ ] **Step 2: Run it and confirm the third case fails**

```sh
npx vitest run tests/unit/ward-lookup-island.test.ts -t 'Places Autocomplete'
```

Expected: the first two pass (existing behaviour, now pinned), the `data-maps-key` case fails.

- [ ] **Step 3: Pass the key to the form in Home.astro**

Import `mapsConfig`, call it in frontmatter, and add to the `[data-ward-lookup]` form element:

```astro
  data-maps-key={maps.enabled ? maps.browserKey : undefined}
```

An `undefined` attribute value is omitted entirely by Astro, which is what the disabled case asserts.

- [ ] **Step 4: Attach autocomplete in the island**

Add to `src/islands/WardLookup.ts`, and call it from `initWardLookup` after the existing element lookups:

```ts
/**
 * GBA-area viewport bias for Places Autocomplete. Same padded bounding box
 * as src/lib/geocode.ts's GBA_BOUNDS_* (see that file for the derivation and
 * for why this is a soft bias, not a hard locality filter — the GBA includes
 * former CMC/TMC areas Google does not reliably label "Bengaluru").
 */
const GBA_BOUNDS = { south: 12.7834, west: 77.4098, north: 13.1927, east: 77.8341 };

/**
 * Attaches Google Places Autocomplete to the lookup input, when a browser
 * key was rendered onto the form (src/lib/maps-config.ts). Failure to load
 * is a no-op: the input is a plain text field either way, and the submit
 * handler below does not depend on autocomplete having run.
 *
 * IMPORTANT (spec §6): selecting a place fills the INPUT with the place's
 * formatted address and nothing more. This island never sends coordinates
 * to /api/ward-lookup — the server geocodes and resolves the ward itself,
 * which is what keeps geocode_cache free of citizen locations. Do not
 * "optimize" this by posting the place's lat/lng.
 */
async function attachAutocomplete(form: HTMLFormElement, input: HTMLInputElement): Promise<void> {
  const apiKey = form.dataset.mapsKey;
  if (!apiKey) return;

  try {
    const { Loader } = await import('@googlemaps/js-api-loader');
    const loader = new Loader({ apiKey, version: 'weekly' });
    const places = (await loader.importLibrary('places')) as google.maps.PlacesLibrary;

    const autocomplete = new places.Autocomplete(input, {
      bounds: GBA_BOUNDS,
      componentRestrictions: { country: 'in' },
      fields: ['formatted_address'],
    });

    autocomplete.addListener('place_changed', () => {
      const address = autocomplete.getPlace()?.formatted_address;
      if (address) input.value = address;
    });
  } catch {
    // Script blocked, offline, or refused by CSP — the plain input stands.
  }
}
```

Then in `initWardLookup`, after `if (!input || !result) return;`:

```ts
  void attachAutocomplete(form, input);
```

- [ ] **Step 5: Run the island tests and confirm they pass**

```sh
npx vitest run tests/unit/ward-lookup-island.test.ts
```

Expected: PASS, including every pre-existing case.

- [ ] **Step 6: Add a Home.astro route assertion**

Add to `tests/routes/home.test.ts` a case asserting `data-maps-key` is present when `MAPS_ENABLED=true` with a key set, and absent otherwise — mirroring the env save/restore pattern from Task 3 Step 6.

- [ ] **Step 7: Run it**

```sh
npx vitest run tests/routes/home.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add src/features/pages/Home.astro src/islands/WardLookup.ts tests/unit/ward-lookup-island.test.ts tests/routes/home.test.ts
git commit -m "feat(lookup): add Places Autocomplete to the ward lookup

Biased to the GBA bbox, restricted to IN. Selecting a place fills the
input with a formatted address — the island still posts an address and
never coordinates, so geocode_cache stays free of citizen locations."
```

---

### Task 6: Booth directions links

Free — `booths` already carries `lat`/`lng` (`src/db/schema.ts:127-129`) and `/api/booth-lookup` already returns them.

**Files:**
- Create: `src/lib/maps-links.ts`
- Modify: `src/features/pages/FindBooth.astro` (server-rendered POST branch, ~line 145)
- Modify: `src/islands/BoothLookup.ts` (`renderBooths`)
- Modify: `src/i18n/en.json`
- Test: `tests/unit/maps-links.test.ts` (create), `tests/routes/booth-lookup.test.ts`, `tests/unit/booth-lookup-island.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `directionsUrl(lat: string, lng: string): string`.

**Both render paths need this.** `FindBooth.astro`'s POST branch and `BoothLookup.ts`'s `renderBooths()` are separate code producing the same list; changing one without the other ships a link that appears for only half of visitors. Both are asserted below.

- [ ] **Step 1: Write the failing helper test**

Create `tests/unit/maps-links.test.ts`:

```ts
/**
 * Coverage for src/lib/maps-links.ts (spec §7). A plain Google Maps deep
 * link — no API, no key, no billing, and it works with JS off.
 */
import { describe, it, expect } from 'vitest';
import { directionsUrl } from '../../src/lib/maps-links';

describe('directionsUrl', () => {
  it('builds a Maps directions URL from a lat/lng pair', () => {
    const url = new URL(directionsUrl('12.9716', '77.5946'));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('destination')).toBe('12.9716,77.5946');
  });

  it('encodes the destination rather than interpolating raw', () => {
    expect(directionsUrl('12.9716', '77.5946')).toContain('destination=12.9716%2C77.5946');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```sh
npx vitest run tests/unit/maps-links.test.ts
```

Expected: FAIL — cannot resolve `src/lib/maps-links`.

- [ ] **Step 3: Implement it**

Create `src/lib/maps-links.ts`:

```ts
/**
 * Google Maps deep links (spec §7).
 *
 * Deliberately NOT an API call: this builds a plain URL a citizen's browser
 * or Maps app opens. No key, no billing, no quota, and the link works with
 * JavaScript disabled — which matters, because /voting-guide/find-booth's
 * whole no-JS path server-renders its results.
 *
 * Shared by BOTH booth render paths (FindBooth.astro's POST branch and
 * BoothLookup.ts's renderBooths) so the two cannot drift.
 */
export function directionsUrl(lat: string, lng: string): string {
  const params = new URLSearchParams({ api: '1', destination: `${lat},${lng}` });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
```

- [ ] **Step 4: Run it and confirm it passes**

```sh
npx vitest run tests/unit/maps-links.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Add the UI string**

Add to `src/i18n/en.json`, alphabetically among the other `findBooth.result.*` keys:

```json
  "findBooth.result.directions": "Directions",
```

Then generate the Kannada:

```sh
npm run translate            # needs ANTHROPIC_API_KEY
npm run translate -- --check # must pass
```

If no API key is available, add the key to `src/i18n/kn.json` by hand for now and note that `--check` will regenerate it. Hand-edited Kannada is overwritten by design — corrections belong in `src/i18n/glossary.json`.

- [ ] **Step 6: Write the failing render tests**

In `tests/routes/booth-lookup.test.ts` (server-rendered branch):

```ts
it('renders a directions link for each booth (spec §7)', async () => {
  const html = await renderFindBoothPost({ address: FIXTURE_ADDRESS });
  expect(html).toContain('https://www.google.com/maps/dir/');
  expect(html).toContain('destination=12.9716%2C77.5946');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('target="_blank"');
});
```

In `tests/unit/booth-lookup-island.test.ts` (island branch):

```ts
it('renders a directions link for each booth (spec §7)', async () => {
  const { container } = await renderBoothResult([
    { id: 1, nameEn: 'Booth A', nameKn: '', address: 'Somewhere', lat: '12.9716', lng: '77.5946', wardId: 1001 },
  ]);
  const link = container.querySelector<HTMLAnchorElement>('a[href*="google.com/maps/dir"]');
  expect(link).not.toBeNull();
  expect(link!.href).toContain('destination=12.9716%2C77.5946');
  expect(link!.rel).toContain('noopener');
  expect(link!.target).toBe('_blank');
});
```

Adapt the helper names to whatever each file already uses.

- [ ] **Step 7: Run both and confirm they fail**

```sh
npx vitest run tests/routes/booth-lookup.test.ts tests/unit/booth-lookup-island.test.ts -t 'directions link'
```

Expected: FAIL in both files.

- [ ] **Step 8: Add the link to the server-rendered branch**

In `src/features/pages/FindBooth.astro`, import `directionsUrl` and add inside the booth `<li>`:

```astro
              <a
                href={directionsUrl(b.lat, b.lng)}
                target="_blank"
                rel="noopener noreferrer"
                data-external-link
              >
                {t(lang, 'findBooth.result.directions')}
              </a>
```

- [ ] **Step 9: Add the link to the island branch**

In `src/islands/BoothLookup.ts`, import `directionsUrl` and thread the label
through. This island deliberately imports no i18n table (see its header), so
the string arrives as a `data-msg-*` attribute like every other one it uses.

Change `renderBooths`' signature to take the label, and extend the item:

```ts
function renderBooths(
  container: HTMLElement,
  lang: string,
  label: string,
  directionsLabel: string,
  booths: BoothRow[],
): void {
```

```ts
    const directions = document.createElement('a');
    directions.href = directionsUrl(booth.lat, booth.lng);
    directions.target = '_blank';
    directions.rel = 'noopener noreferrer';
    directions.textContent = directionsLabel;
    item.append(name, address, directions);
```

In `initBoothLookup`, read it alongside the existing messages:

```ts
    directions: form.dataset.msgDirections ?? '',
```

and pass `msgs.directions` at the `renderBooths(...)` call site.

Add the attribute to `FindBooth.astro`'s form:

```astro
    data-msg-directions={t(lang, 'findBooth.result.directions')}
```

- [ ] **Step 10: Run both test files and confirm they pass**

```sh
npx vitest run tests/routes/booth-lookup.test.ts tests/unit/booth-lookup-island.test.ts
```

Expected: PASS, including every pre-existing case.

- [ ] **Step 11: Commit**

```sh
git add src/lib/maps-links.ts src/features/pages/FindBooth.astro src/islands/BoothLookup.ts src/i18n/en.json src/i18n/kn.json tests/unit/maps-links.test.ts tests/routes/booth-lookup.test.ts tests/unit/booth-lookup-island.test.ts
git commit -m "feat(booth): link each booth result to Google Maps directions

Plain deep link built from the lat/lng booths already carry — no API, no
key, works with JS off. Shared helper so the server-rendered and
island-rendered paths cannot drift."
```

---

### Task 7: Documentation

The migration is not done until the docs stop describing MapLibre.

**Files:**
- Modify: `docs/architecture.md`, `docs/project-dependencies.md`, `docs/design-system.md`, `deploy/runbook.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/architecture.md`**

- §3 "Decided vendors": MapLibre rendering → Google Maps JavaScript API, and note Places Autocomplete as a new metered SKU.
- §6 geo table row: "Ward polygons as static GeoJSON (MapLibre reads them directly)" → served per-ward from `/ward/<id>/boundary.json`; in-memory point-in-polygon and "no PostGIS" unchanged.
- §5 islands list: "MapLibre maps" → "Google Maps ward boundary map".

- [ ] **Step 2: `docs/project-dependencies.md` §6.4 — close it**

Rewrite the §6.4 row and its prose block. The restriction (Google Maps content may not be used in an app displaying a non-Google map) no longer applies now that rendering is Google. Record: the date, that the constraint is resolved rather than merely complied with, that Places Autocomplete brings its own per-session metering, and that `src/lib/geocode.ts`'s no-coordinates rule was **kept on privacy grounds** even though §6.4 no longer compels it.

Add rows for the new credentials, pointing at `docs/gcp.md`.

- [ ] **Step 3: `deploy/runbook.md`**

Add three rows to "Required environment variables":

| Variable | Required | Notes |
|---|---|---|
| `GOOGLE_MAPS_BROWSER_KEY` | yes (ward map, autocomplete) | Referrer-restricted browser key. Unset means the map and autocomplete are absent; the ward page renders its fallback. `docs/gcp.md` §3. |
| `GOOGLE_MAPS_MAP_ID` | recommended | Cloud map style (`docs/gcp.md` §4). Unset renders an unstyled basemap. |
| `MAPS_ENABLED` | yes to show maps | Kill switch. Must be exactly `true`. Sheds client-side map spend without a rebuild when a budget alert fires. |

- [ ] **Step 4: `docs/design-system.md` §8**

Remove the "we have no tile-provider key/vendor wired up yet" caveat. Record that the basemap is a cloud Map ID, that the style is console-managed and therefore invisible to code review, and that the boundary colors are still token-driven.

- [ ] **Step 5: `CLAUDE.md`**

- Islands section: MapLibre → Google Maps JS. **Keep the `assetsInlineLimit: 0` rule** — it applies to every island, not just the map.
- Architecture summary line: MapLibre → Google Maps.
- Docs list: add `docs/gcp.md`.
- Gotchas: `/data/gba.geojson` is still served by nginx from the static volume and `static-init` still does not re-run — that entry stands unchanged, but the map no longer fetches it.

- [ ] **Step 6: E2E**

The ward map cannot be meaningfully asserted without a live key and real
network, so E2E asserts the page around it, not the map. In the ward-page
spec under `tests/e2e/`, assert the map container renders with its fallback
text and that no uncaught console error escapes the page. **Do not assert a
canvas** — it will pass or fail depending on whether the E2E environment has
a key, which makes the suite nondeterministic.

```sh
npm run build:e2e
DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_e2e npm run seed:e2e
npm run test:e2e
```

Expected: PASS. Note the first command is `build:e2e`, not `build`.

- [ ] **Step 7: Full verification**

```sh
export DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test
npm test
npm run typecheck
npm run translate -- --check
```

All three must pass. Nothing in CI will run them.

- [ ] **Step 8: Commit**

```sh
git add docs/ deploy/runbook.md CLAUDE.md
git commit -m "docs: record the Google Maps migration, close dependency 6.4

6.4 asked whether the geocoding architecture was licensed at all, given
Google's restriction on using its content alongside a non-Google map.
Rendering is Google now, so the question is resolved rather than
defended. geocode.ts's no-coordinates rule is kept on privacy grounds."
```

---

## Post-implementation, before deploying

These need credentials from `docs/gcp.md` and cannot be automated.

- [ ] Staging `.env.staging` gets `GOOGLE_MAPS_BROWSER_KEY` (the **staging** key, Key C), `GOOGLE_MAPS_MAP_ID`, `MAPS_ENABLED=true`. Confirm `SENDS_DISABLED=true` is still set and no messaging vendor key was added alongside.
- [ ] Deploy to staging. Load a ward page and confirm a styled basemap with a forest-colored boundary and no markers.
- [ ] Confirm the ward lookup autocompletes a partial Bengaluru address, and that a 6-digit pincode still bypasses it.
- [ ] Confirm a booth result's directions link opens Google Maps at the right place.
- [ ] Set `MAPS_ENABLED=false`, restart, confirm the ward page renders its fallback with no console error and no request to `maps.googleapis.com`.
- [ ] Check the browser console for CSP violations on `/ward/<id>` and `/`.
- [ ] **Do a real POST on staging** — `CLAUDE.md`'s `SITE_ORIGIN` warning: a build made without the right origin serves every GET a healthy 200 and 403s every POST, invisibly.
- [ ] Confirm GCP quota caps and budget alerts from `docs/gcp.md` §5 are actually set before production.
- [ ] Production deploy uses the **production** browser key (Key B). Verify the referrer restriction rejects the staging hostname.
