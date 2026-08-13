# MapLibre → Google Maps Platform

Decided 2026-08-13. Supersedes the rendering half of `docs/architecture.md`
§3 and §6 ("MapLibre reads them directly"), and closes
`docs/project-dependencies.md` §6.4. Credential procurement is
`docs/gcp.md`; this document is the design that consumes those credentials.

---

## 1. Why

Two reasons, one of which is the real one.

**§6.4 is unresolved and invisible.** Google Maps Platform's terms restrict
using Google Maps content — geocoding results included — in an application
that displays a non-Google map. The current stack is precisely that pattern:
Google geocodes, MapLibre renders. The register's own assessment is that the
architecture complies "more by consequence than by intent", and names the
risk correctly: *"A future contributor who reads 'returns a ward, not a
point' without knowing why will eventually, helpfully, return the point."*
Rendering on Google dissolves the question rather than continuing to defend
it with a comment block.

**The address lookup dead-ends.** `src/lib/geocode.ts` classifies any result
where `results.length !== 1 || partial_match` as `ambiguous`, and
`/api/ward-lookup` degrades that to `use_pincode` — which lands on
`data/pincode-wards.json`, still the 12-row placeholder. A citizen typing a
real but imprecise Bengaluru address today gets nothing. Places Autocomplete
resolves ambiguity in the input, before it ever reaches the server, and is
only licensed alongside a Google map.

There is also a smaller truth worth stating plainly: **the current map has no
basemap.** `buildBaseStyle()` returns a single background layer and no tile
source. Today's ward map is a flat gray rectangle with one polygon on it. The
migration is not replacing a working basemap; it is adding the first one.

## 2. What this costs, and what was decided anyway

Maps JavaScript API bills per map load, on the highest-traffic page, during
an election traffic spike. `docs/project-dependencies.md` §6.11 notes no
total running budget has been put on paper, and the GTM plan targets 300,000
unique visitors.

The load strategy was chosen deliberately with that in front of us: **lazy on
scroll, as today** — the map constructs when its container enters the
viewport. A tap-to-load variant behind a server-rendered SVG placeholder was
considered and rejected in favour of the better experience. The mitigations
are operational, not architectural, and are specified in §8: a `MAPS_ENABLED`
kill switch, GCP quota caps as a circuit breaker, and budget alerts as the
signal that actually matters.

Recording this so the decision is not re-litigated later as an oversight. It
was a choice.

## 3. What does not change

- `src/lib/geo.ts` — untouched. Point-in-polygon, the composite id scheme,
  `loadWardPolygons()`'s idempotent module guard, and the "no PostGIS" rule
  of `architecture.md` §6 all stand.
- `src/lib/geocode.ts`'s **no-coordinates rule stands.** §6.4 no longer
  forces it, but it is also a privacy property: `geocode_cache` stores
  normalized address → ward id and has never held a citizen's location.
  Relaxing it is a separate decision with its own DPDP argument. The file's
  header block gets rewritten to say *that* rather than deleted — the rule
  outlives its original justification.
- The caching invariant (`architecture.md` §5). Every surface below is either
  static public markup or a public GET that reads no session.
- Progressive enhancement. Every form still works with JS off; every island
  still fails closed to server-rendered markup.
- The pincode branch. A bare 6-digit input still bypasses geocoding entirely.

## 4. Boundary data

Today `src/islands/WardMap.ts` fetches the whole of `data/gba.geojson` —
3.5 MB, 369 features — and linear-scans it to find one polygon. That is
replaced.

**New route: `src/pages/ward/[id]/boundary.json.ts`**, served at
`/ward/<id>/boundary.json`.

- `GET` only. Calls `loadWardPolygons()` (idempotent) and returns the single
  matching feature as a GeoJSON `Feature`, roughly 10 KB.
- Unknown or non-numeric id → 404 with a JSON body.
- Reads no cookie, sets no cookie. Not localized — this is language-neutral
  geometry, so there is no `/kn/` twin.

**It deliberately does not live under `/api/`.** Two reasons, both in
`deploy/nginx/conf.d/site.conf`:

1. `location /api/` (site.conf:100) is **uncached** — it proxies straight to
   the app with no `proxy_cache`. A boundary endpoint there would be
   re-serialized and round-tripped on every ward pageview.
2. That same location carries `limit_req zone=api burst=60 nodelay`, a zone
   shared with the write endpoints (issue votes, flags, EOI). An asset
   fetched during ordinary ward browsing does not belong in a rate-limit
   bucket sized for writes.

There is also a convention argument: every existing `/api` route sets
`cache-control: no-store`, and a cacheable one there would be the odd one
out.

At `/ward/<id>/boundary.json` the route falls into the general public
location (site.conf:182), which already does exactly what is wanted —
`proxy_set_header Cookie ""`, `proxy_ignore_headers Set-Cookie`,
`proxy_cache_key "$scheme$host$uri"` (query string ignored, per the caching
invariant), `proxy_cache_valid 200 60s`. **No nginx change is required for
this to work correctly.**

*Optional follow-up, not required:* ward boundaries never change between
delimitations, so a longer TTL is warranted. The precedent is the cached
location at site.conf:157 (`ward/[^/]+/issues|data`, 5m), whose regex could
be extended to include `boundary\.json`. This is a pure optimization and it
is scoped out of the initial implementation, because a change under
`deploy/nginx/` triggers the special deploy path in `deploy/runbook.md`
("The one exception") and is not worth coupling to this migration.

This makes `geo.ts`'s 3.5 MB parse reachable from a second path. That is
acceptable: it is the same cost the address-lookup path already pays on first
use, the module guard means it happens once per process, and it is now paid
on a route whose response nginx caches.

**Consequences in `Ward.astro`:** `data-boundary-url` becomes
`/api/ward/<id>/boundary`. The `#<boundaryRef>` fragment convention
disappears, so `parseBoundaryUrl()` and `findWardFeature()` are both deleted
from the island. `wards.boundaryRef` stays in the schema — `seed-wards.ts`
and `geo.ts` still use it — but `Ward.astro` no longer formats a URL from it.

## 5. The ward map island

`src/islands/WardMap.ts` keeps its public shape — `initWardMap(root?)` and
`mountWardMap(container)` — so `Ward.astro`'s script block is unchanged.
Internals are replaced.

**Loader.** `@googlemaps/js-api-loader`, which injects a
`<script src="https://maps.googleapis.com/…">` at runtime. A script element
whose `src` matches a host in `script-src` does not additionally need the
nonce, so this works under the existing nonce-only policy once the host is
allowlisted (§7). `maplibre-gl` and its CSS import are removed, and the
package leaves `package.json`.

**Styling.** `buildBaseStyle()` is deleted; the basemap comes from the Map ID
(`docs/gcp.md` §4). But `readMapColors()` **stays**: the ward polygon is
still drawn by us, still reading `--oc-forest` and `--forest-tint` off
computed CSS custom properties. Its `--gray-100` background read is dropped —
that existed only to color `buildBaseStyle()`'s empty background layer, and a
real basemap now occupies that space. This keeps
`design-system.md` §8 satisfied (2px forest boundary, 30% tint fill, no red
pins, nothing party-colored) and keeps the island inside the hex-literal ban
that `tests/unit/tokens.test.ts` enforces. The polygon is added through
`map.data.addGeoJson()` and styled from those tokens; `disableDefaultUI` is
set; no marker is ever created.

**Bounds.** `computeFeatureBounds()` survives as a pure, directly-tested
function. Only its consumer changes — it feeds a `google.maps.LatLngBounds`
rather than MapLibre's nested-tuple form.

**Lazy mount.** The `IntersectionObserver` wiring is unchanged, including its
fallback to immediate mount where the observer is unavailable.

**Failure-closed contract — the part most likely to regress.** Today every
failure path returns *before* `container.textContent = ''`, so the
server-rendered no-JS fallback survives untouched and the rest of the ward
page is unaffected. Google fails in two shapes the current try/catch does not
cover:

1. The loader's promise rejects (script blocked, offline, CSP violation).
2. The script loads successfully and *then* `gm_authFailure` fires — bad key,
   referrer mismatch, billing disabled. This is asynchronous and arrives
   after `mountWardMap` has already returned.

Both must leave the fallback text in place, which means the container is
cleared only once a `google.maps.Map` object actually exists, and the
`gm_authFailure` path must restore the fallback if it has already been
cleared.

`gm_authFailure` is a **global `window` callback, not a per-map one.**
Exactly one handler may be installed, once, idempotently. Only one map exists
on the site today, but the constraint belongs in the code as a comment, not
in this document alone.

## 6. Places Autocomplete on the ward lookup

`src/islands/WardLookup.ts` attaches an autocomplete widget to
`input[name="query"]`, biased to the GBA bounding box already hardcoded at
`src/lib/geocode.ts:87-90` and restricted to `country: 'in'`.

Two invariants:

- **The pincode branch is untouched.** `PINCODE_RE` still matches first; a
  bare 6-digit string never reaches autocomplete and never spends an
  autocomplete session.
- **The island posts an address, never coordinates.** On selection it sends
  `{ address: <formatted_address> }` to `/api/ward-lookup`, exactly as a
  typed address would be. The server still geocodes and still resolves via
  `wardForPoint`. This keeps one resolution path rather than two, keeps
  `geocode_cache` coordinate-free, and means every existing test of that
  endpoint stays valid.

The benefit is upstream of the server: a selected place is unambiguous, so
`results.length !== 1 || partial_match` fires far less often, and the
`use_pincode` → placeholder-table dead end is reached far less often.

Autocomplete degrades to a plain text input if the script fails to load —
which is what the input already is. No new failure mode.

**Note for §6.4's closing entry:** Places is a distinct SKU with its own
metering, billed per session rather than per request. The register already
anticipates this.

## 7. Booth directions

`booths` already carries `address`, `lat` and `lng`
(`src/db/schema.ts:127-129`), and `/api/booth-lookup` already returns all
three to the client. So this is a markup change with no API, no key and no
billing.

Each booth result gains a link to:

```
https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>
```

`target="_blank" rel="noopener noreferrer"`, with the external-link glyph and
its `aria-label`, following `src/components/ExternalLinkOut.astro` and
`design-system.md` §7.13.

**Both render paths need it.** `FindBooth.astro`'s server-rendered `POST`
branch and `BoothLookup.ts`'s `renderBooths()` are separate code that
produce the same list; a change to one without the other ships a link that
appears only for half the visitors. This has to be asserted in tests, not
just remembered.

Works with JS off. Works when Maps is disabled by `MAPS_ENABLED`.

## 8. Configuration and cost control

Three new runtime environment variables:

| Variable | Purpose | Absent behaviour |
|---|---|---|
| `GOOGLE_MAPS_BROWSER_KEY` | Maps JS + Places, referrer-restricted | map and autocomplete absent; fallback text renders |
| `GOOGLE_MAPS_MAP_ID` | cloud style association | map renders unstyled |
| `MAPS_ENABLED` | kill switch | treated as off |

**None of these may be `PUBLIC_*`.** Astro inlines `PUBLIC_*` at build time,
which is the exact failure `CLAUDE.md` documents for `SITE_ORIGIN`: an image
built without the value serves every GET a healthy 200 and a broken map, with
nothing in `docker compose ps`, the healthcheck, or the logs to indicate it.
Both values are read in server frontmatter and passed onto the map container
as data attributes — the pattern `data-boundary-url` already uses — so they
stay runtime configuration that a container restart can change.

Unset keys degrade to a documented no-op rather than an error, per the house
rule in `CLAUDE.md`.

`MAPS_ENABLED` exists because a GCP quota cap is not the same kind of guard
as `GEOCODE_DAILY_BUDGET`. The geocode budget *degrades* — exhausting it
returns `use_pincode` and the citizen still gets an answer. A GCP quota
simply starts erroring, and the map breaks for every visitor at once. So the
quota is set high as a runaway-spend circuit breaker, the budget alert is the
real signal, and `MAPS_ENABLED` is the lever that sheds client-side spend
without a rebuild and redeploy. Nothing in Google's console provides that.

**CSP** (`src/lib/csp.ts`): `https://maps.googleapis.com` and
`https://maps.gstatic.com` are added to `script-src`, `connect-src` and
`img-src` in the **base** policy — not as a path-scoped extension like the
`/partner-with-us` reCAPTCHA relaxation. The ward map and the home-page
autocomplete live on different routes, and maintaining two more path
extensions costs more than it protects. `worker-src 'self' blob:` stays
unchanged, but its comment — which currently explains the directive as
MapLibre-specific — becomes wrong and must be rewritten.

## 9. Deferred: Maps Static API

Considered and **not** in this release.

The original framing was ward images for `/partner-kit`, which does not
survive contact with the code: `/partner/{slug}` renders per-partner WhatsApp
forward text and has no ward context to illustrate.

The real candidate is ward-page Open Graph images — `Base.astro:121` already
accepts an `ogImage` prop, and a map thumbnail in WhatsApp forwards suits the
GTM plan's distribution model. It is deferred for one reason: Google's terms
restrict caching and storing Maps imagery, so pre-rendering 369 PNGs into the
repo needs exactly the deliberate terms check that §6.4 asked for and never
received. The alternative — hot-linking a Static Maps URL from public cached
HTML — bills on every social-crawler fetch from a URL nothing in the
application can rate-limit.

So: no user has asked for it, and it is the only item in this migration
carrying an unresolved licensing question. Revisit it as its own decision,
with its own terms review, once the rest is live.

## 10. Testing

| File | Change |
|---|---|
| `tests/unit/ward-map-island.test.ts` | Rewrite. `computeFeatureBounds` stays a pure-function test. Add: loader rejection leaves fallback intact; `gm_authFailure` after a successful load restores fallback; container is not cleared before a map exists. |
| `tests/unit/csp.test.ts` | Assert the two new hosts in all three directives; assert the `/partner-with-us` reCAPTCHA extension still applies on top. |
| `tests/routes/ward-boundary.test.ts` (new) | 200 shape for a real ward, 404 for unknown/non-numeric id, no `set-cookie`. |
| `tests/routes/cache-invariant.test.ts` | Guard 1 (public GET cache-invariance) should cover `/ward/<id>/boundary.json` — it is a new public cached route, which is exactly what that suite exists to police. |
| `tests/routes/ward.test.ts` | `data-boundary-url` points at the new endpoint; `MAPS_ENABLED` off renders fallback and mounts no island. |
| `tests/routes/booth-lookup.test.ts` | Directions link present in the server-rendered `POST` branch. |
| `tests/unit/booth-lookup-island.test.ts` | Directions link present in the island-rendered branch — the §7 pairing. |

**E2E:** the ward map cannot be meaningfully asserted without a live key and
real network. Playwright asserts the container and its fallback render, and
that no console error escapes. It does not assert a canvas.

`npm run translate -- --check` must pass: every new UI string needs an `en`
key and a generated `kn` counterpart. New strings are the directions-link
label and its `aria-label`.

## 11. Documentation to update

- `docs/architecture.md` §3 (decided vendors) and §6 (the geo row still says
  "MapLibre reads them directly") and §5's islands list.
- `docs/project-dependencies.md` §6.4 — close it. Record that rendering moved
  to Google, that the restriction no longer applies, and that Places brings
  its own metering.
- `deploy/runbook.md` — three new rows in "Required environment variables".
- `docs/design-system.md` §8 — the "no tile provider wired up yet" caveat
  becomes false.
- `CLAUDE.md` — the Islands section names MapLibre and explains
  `assetsInlineLimit: 0` partly in its terms. The `assetsInlineLimit` rule
  itself still stands for every other island and must not be removed.
- `docs/gcp.md` — already written; add a pointer from `CLAUDE.md`'s docs list.

## 12. Risks

1. **Per-load billing on the highest-traffic page**, with quota caps that
   break rather than degrade. Accepted knowingly (§2); mitigated by
   `MAPS_ENABLED` and budget alerts.
2. **Map styling moves into console state** invisible to code review, absent
   from this repo, and untestable. A style change will produce a visible
   production change with no commit. Convention: note it in a commit message
   anyway.
3. **`gm_authFailure` is global and single-slot.** A second map island added
   later will clobber the first's handler silently.
4. **Referrer restriction is the only defence** on a browser key, and staging
   is publicly reachable since basic auth was removed (`7782078`). Hence the
   separate staging key in `docs/gcp.md` §3.
5. **A build-time-inlined key would fail invisibly** — the `SITE_ORIGIN`
   failure mode, on a different variable. §8 is the guard; a review that lets
   a `PUBLIC_*` maps variable through re-opens it.
6. **No CI gates any of this.** Per `CLAUDE.md`, `npm test`, `npm run
   typecheck` and `npm run translate -- --check` must be run by hand before
   deploying. Nothing else will.

## 13. Out of scope

Booth-locator maps (`/voting-guide/find-booth` stays a text list plus the new
directions links), any map on the compare or candidate pages, address
autocomplete on the booth lookup, and Maps Static API (§9).
