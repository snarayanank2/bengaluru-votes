# Google Maps migration — deferred follow-ups

Carried out of the `google-maps-migration` branch (2026-08-14). This is a
**live working document** tracking what's still open on that branch, not a
historical record — update it as items get resolved rather than leaving it
to drift. (For the historical record of what was implemented and why, see
`docs/superpowers/specs/2026-08-13-google-maps-migration-design.md` and its
plan; those are not rewritten as work lands.)

Since this file was first written, three of its items have resolved and one
follow-up cluster changed weight — see "Resolved since this file was
written" below the blockers. Two blockers remain open.

---

## Blockers before this branch is deployed

These are **not** optional follow-ups. They gate the deploy.

### 1. Kannada regeneration — the branch fails its own bilingual gate

`npm run translate -- --check` exits 1, listing:

- `findBooth.result.directions`
- `findBooth.result.directionsAriaLabel`
- `home.form.helper`
- `home.result.ambiguous`
- `home.result.unavailable`
- `content/pages/kn/find-booth.md`

All are hand-written and carry no `__hashes` entry, because
`ANTHROPIC_API_KEY` was unavailable in the environment that built the
branch — first for the booth directions link, then again for the
address-only ward lookup that replaced pincode search. The hash was
deliberately **not** hand-written: doing so asserts a machine translation
that never happened, and — worse — marks the key non-stale so
`npm run translate` would never regenerate it, permanently freezing a
hand-written string past the pipeline `CLAUDE.md` designates as the source
of truth for Kannada.

Fix: run `npm run translate` with a real key, confirm `--check` exits 0, and
commit the regenerated `kn.json` / `content/pages/kn/find-booth.md`. The
`__hints` entries for the `en.json` keys are already in place, so
regeneration has the context it needs. **Not done as of 2026-08-14** —
`ANTHROPIC_API_KEY` remains unavailable in the environment working this
branch.

### 2. E2E was never run on this branch

It needs a separate build and database that were unavailable. Run
`npm run build:e2e`, `seed:e2e`, `test:e2e` before deploying. **Not done as
of 2026-08-14.**

One thing worth knowing going in: the address→ward happy path is no longer
E2E-testable the way it was under pincode mode — it now needs a real Google
Geocoding key, which the E2E environment doesn't have. Coverage for it lives
at the route level instead, against a mocked geocoder
(`tests/routes/`-level, not Playwright). That's an accepted gap in the E2E
suite's coverage, not a bug to fix as part of running E2E — don't try to make
E2E cover it by wiring in a real key.

---

## Resolved since this file was written

### CSP completeness — fixed and verified in a real browser

Was blocker #2 here. `src/lib/csp.ts` now carries the following, verified in
a real browser against the **local** Docker stack with a real key and
`MAPS_ENABLED=true` — not yet against staging or production:

- `script-src`, `connect-src`, `img-src`: `https://maps.googleapis.com`,
  `https://maps.gstatic.com`
- `style-src`: `https://fonts.googleapis.com` (Maps UI stylesheets)
- `font-src`: `https://fonts.gstatic.com` (the font files)
- `connect-src`: `https://places.googleapis.com`

The last one is the finding worth remembering: it is **not** the same host
as `maps.googleapis.com`. Places API (New) posts its autocomplete RPCs to
`places.googleapis.com` — a separate host, separate SKU, separate product
surface from Maps JS. Without that host in `connect-src`, every keystroke in
the autocomplete box was silently blocked by CSP and no suggestions ever
appeared, with no console error that pointed at CSP as the cause (it read
like a broken/empty autocomplete, not a security block). Anyone extending
Places usage later should assume nothing about which `googleapis.com`
subdomain a given Places call uses and check the network tab, not guess by
analogy to Maps JS.

Also worth remembering there are four distinct `gstatic`-family hosts in
play across this app, not to be conflated: `fonts.gstatic.com`,
`maps.gstatic.com`, `www.gstatic.com` (reCAPTCHA, `/partner-with-us` only).

### The Places Autocomplete design fork — resolved

Was the "open design decision" section here. The fork was between (a)
swapping `PlaceAutocompleteElement` in for the input, and (b) driving a
custom suggestion list off the Autocomplete Data API
(`fetchAutocompleteSuggestions`). **(a) was chosen and shipped**
(`src/islands/WardLookup.ts`, `attachAutocomplete`):

- Attached only when the server rendered `data-maps-key` (Home.astro).
- Carries the original input's `id` across, so the existing `<label for>`
  still resolves — verified in a real browser's accessibility tree
  (`combobox "Address (Required)"`).
- Biased to the GBA bbox (`locationBias`), restricted to `includedRegionCodes:
  ['in']`, requests predictions in the visitor's language.
- On `gmp-select` it reads `placePrediction.text` and stops — no
  `toPlace()`/`fetchFields()` call. That avoids a second billed request and,
  more importantly, means the island never learns a position; the server
  still does the geocoding, so `geocode_cache` still holds address → ward id
  only, never coordinates.
- Failure (no key, blocked script, CSP refusal, `gmp-error`) is a no-op: the
  plain server-rendered `<input>` stands, same as before autocomplete
  existed.

Verified working in a real browser: predictions return, all Bengaluru.

### Shared loader module extracted

`src/lib/maps-loader.ts` now owns the one-time `setOptions()` call (Maps JS
API v2's functional API — the `Loader` class's constructor throws
unconditionally) and is shared by both islands that need the API
(`WardMap.ts`, `WardLookup.ts`), so they can't independently race to
configure it with different keys.

### `wardBoundaryUrl()` deleted

The old `/data/gba.geojson#<ref>` URL builder in `src/lib/geo.ts` had no
production caller left after `/ward/<id>/boundary.json` replaced the
island's whole-collection fetch. It's gone; so is its test.

---

## Now more load-bearing because of pincode removal

Pincode lookup was removed from `/api/ward-lookup` on this branch (separate
from the Maps work, but on the same branch and interacting with it).
**Geocoding is now the only path from an address to a ward — there is no
fallback and no browsable ward list.** That changes the priority of a few
things already true before, and is worth stating plainly here rather than
letting it sit implicitly inside item-level notes below:

- Exhausting `GEOCODE_DAILY_BUDGET` (default 2000/day, deliberately
  unchanged) or a Google outage now takes ward lookup down for every citizen
  at once, not just degrades it to pincode mode. This was a knowing trade
  (the pincode table never advanced past a 12-row placeholder), but it means
  the budget-alert wiring in `docs/gcp.md` §5 — "treat the budget alert as
  the signal that actually matters" — is no longer a nice-to-have, it's the
  only thing standing between normal operation and the platform's primary
  user journey (PRD §5.1) going dark.
- `tests/load/k6-election-day.js` was written assuming `/api/ward-lookup`
  traffic was pincode-mode and therefore free/harmless to fire at
  production. It wasn't updated for pincode removal: as committed it still
  sends `{pincode: ...}` bodies, which are now a 400, not a lookup. See
  `deploy/runbook.md`'s k6 section for the consequence — that script needs
  updating to send addresses before its failure-rate threshold means
  anything, and once fixed it will spend real geocode budget.

---

## Follow-ups, roughly by value

### `src/islands/WardMap.ts`

- **Install `gm_authFailure` before the loader, not after.** Still open —
  it is currently installed after `await importLibrary(...)` and after
  `new maps.Map(...)` (`installAuthFailureHandler()` is called inside the
  post-clear `try`, well after `configureMapsApi(apiKey)`). Google's
  guidance is to define the global before the API loads, since the auth
  check is kicked off by script execution. The network round trip almost
  certainly loses the race — but "almost certainly" is doing real work
  there, and hoisting the call above `configureMapsApi(apiKey)` is free.
- **Re-entrancy guard on `mountWardMap`.** Still open — no
  `if (mounted.has(container)) return;` guard exists. A second mount on an
  already-mounted container would capture Google's own map DOM as
  `fallbackHtml`, destroying the real fallback permanently. Unreachable
  today (plain module script, no `astro:page-load`, unobserve-before-mount),
  but one line of insurance on the single invariant this island exists to
  protect.
- **Shape guard does not check `geometry.coordinates`.** Still open —
  `computeFeatureBounds` will happily walk empty/malformed coordinates into
  non-finite bounds that reach `LatLngBounds`. Needs a malformed committed
  `gba.geojson` to trigger, and it fails closed by accident (the throw lands
  inside the post-clear try/catch, which restores the fallback) — but by
  accident is the operative phrase. Reject non-finite bounds before the
  clear.
- **`mounted` holds strong container references** for the page lifetime with
  no removal on success (only removed in the catch branch). Negligible at
  one map per page; would matter on a multi-map page.

### Tests

- **`tests/unit/csp.test.ts`** — the reCAPTCHA/nonce cases are strong, but
  the Maps host coverage is substring-based. Fine as is; noted for context.
- **Booth directions tests cover only single- and two-booth cases.**
  Adequate.

### `src/features/pages/Ward.astro`

- **Fallback `<p>` markup is duplicated** across the enabled and disabled
  ternary branches. Cosmetic now; it is the thing that drifts if the
  fallback ever gains markup. A single `<div>` with a computed attrs object
  removes it.
- **`data-ward-id` on the map container is vestigial.** The island reads
  only `boundaryUrl`, `mapsKey`, `mapsMapId`. It also lost its test
  assertion during the migration. It survives only in the enabled branch,
  which is a confusing asymmetry for an attribute nothing reads. Delete it.

### Dead ends left by the migration

- **`deploy/nginx/conf.d/site.conf`'s `location /data/gba.geojson`** still
  serves a 3.5 MB file nothing in the app fetches any more (the boundary
  island now hits `/ward/<id>/boundary.json` instead). Harmless, but a
  future reader will infer a live path. Worth one cleanup commit, scoped
  separately since a change under `deploy/nginx/` triggers the runbook's
  special deploy path (production before staging).

### Performance and operations

- **`/ward/<id>/boundary.json` sets no `Cache-Control`.** nginx gives it 60s
  from `location /`. Ward geometry is immutable between delimitations, so a
  long `public, max-age` is free headroom for the election-day spike. The
  longer-TTL nginx route (extending the `site.conf:157` regex) was scoped
  out of the migration deliberately, because a change under `deploy/nginx/`
  triggers the runbook's special deploy path.
- **The kill switch is not instant.** Flipping `MAPS_ENABLED` off and
  restarting leaves up to 60s of nginx-cached ward HTML still carrying
  `data-ward-map` and the browser key. Whoever flips it under a budget alert
  should know that. Note this only sheds map-load spend — it does nothing
  for `GEOCODE_DAILY_BUDGET`, which is a separate spend/kill-switch pair
  covering ward lookup (see "Now more load-bearing" above).
- **CSP widening is unconditional while the feature is gated.**
  `MAPS_ENABLED=false` sheds spend but not attack surface —
  `maps.googleapis.com` and `places.googleapis.com` stay in `script-src` /
  `connect-src` on every route. Scoping the hosts to `/ward/` and `/` (the
  `/partner-with-us` reCAPTCHA extension is the pattern) is now more
  attractive than it was, because both consumers that justified
  base-policy placement have now shipped and are permanent, not one
  hypothetical second consumer.
- **`deploy/compose.local.yml` uses an explicit `environment:` block**, not
  `env_file`, so local development cannot enable maps without editing that
  file. Staging and production need no compose change.

### Documentation

- **`docs/project-dependencies.md` row 6.4's "Owner" column reads
  `resolved`** — a status word in a column labelled Owner. Out of scope for
  this file to fix (that document belongs to a different owner in this
  round of doc updates).
