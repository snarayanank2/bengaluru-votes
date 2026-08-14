# Google Maps migration — deferred follow-ups

Carried out of the `google-maps-migration` branch (2026-08-14). Every item
below was found by a review during that branch, triaged as non-blocking, and
deliberately **not** fixed. None is a known defect in shipped behaviour; each
is either unreachable today, cosmetic, or hardening.

Implemented work: `docs/superpowers/specs/2026-08-13-google-maps-migration-design.md`
and its plan alongside this file.

---

## Blockers before this branch is deployed

These are **not** optional follow-ups. They gate the deploy.

### 1. Kannada regeneration — the branch fails its own bilingual gate

`npm run translate -- --check` exits 1, listing:

- `findBooth.result.directions`
- `findBooth.result.directionsAriaLabel`

Both Kannada values are hand-written and carry no `__hashes` entry, because
`ANTHROPIC_API_KEY` was unavailable in the environment that built the branch.
The hash was deliberately **not** hand-written: doing so asserts a machine
translation that never happened, and — worse — marks the key non-stale so
`npm run translate` would never regenerate it, permanently freezing a
hand-written string past the pipeline `CLAUDE.md` designates as the source of
truth for Kannada.

Fix: run `npm run translate` with a real key, confirm `--check` exits 0, and
commit the regenerated `kn.json`. The `__hints` entries for both keys are
already in `en.json`, so regeneration has the context it needs.

### 2. CSP completeness has never been exercised against a real key

`src/lib/csp.ts` allows `maps.googleapis.com` and `maps.gstatic.com`. Google's
documented CSP for the Maps JS API also lists `fonts.gstatic.com`
(`font-src`, currently `'self'`), `fonts.googleapis.com` (`style-src`), and
`*.googleapis.com` / `*.ggpht.com` in `img-src`.

Why this one matters more than it looks: **the island's failure-closed
contract does not cover it.** Every failure the island handles — loader
rejection, `gm_authFailure` — happens before or instead of a working map. A
CSP-blocked *subresource* happens *after* `container.textContent = ''`, so
the visitor gets a blank box rather than the fallback text.

Fix: on staging, with a real key and `MAPS_ENABLED=true`, load a ward page and
confirm a clean console before enabling maps anywhere public. Widen the policy
if anything is blocked.

### 3. E2E was never run on this branch

It needs a separate build and database that were unavailable. Run
`npm run build:e2e`, `seed:e2e`, `test:e2e` before deploying.

---

## Follow-ups, roughly by value

### `src/islands/WardMap.ts`

- **Install `gm_authFailure` before the loader, not after.** It is currently
  installed after `await importLibrary(...)` and after `new maps.Map(...)`.
  Google's guidance is to define the global before the API loads, since the
  auth check is kicked off by script execution. The network round trip almost
  certainly loses the race — but "almost certainly" is doing real work there,
  and hoisting the call above `configureMapsApi(apiKey)` is free.
- **Re-entrancy guard on `mountWardMap`.** A second mount on an
  already-mounted container would capture Google's own map DOM as
  `fallbackHtml`, destroying the real fallback permanently. Unreachable today
  (plain module script, no `astro:page-load`, unobserve-before-mount), but
  `if (mounted.has(container)) return;` is one line of insurance on the single
  invariant this island exists to protect.
- **Shape guard does not check `geometry.coordinates`.** Empty coordinates
  produce non-finite bounds that reach `LatLngBounds`. Needs a malformed
  committed `gba.geojson` to trigger, and it fails closed by accident (the
  throw lands inside the post-clear try/catch, which restores the fallback) —
  but by accident is the operative phrase. Reject non-finite bounds before the
  clear.
- **`mounted` holds strong container references** for the page lifetime with
  no removal on success. Negligible at one map per page; would matter on a
  multi-map page.

### Tests

- **`tests/unit/csp.test.ts`** — the reCAPTCHA/nonce cases are strong, but the
  Maps host coverage is substring-based. Fine as is; noted for context.
- **Booth directions tests cover only single- and two-booth cases.** Adequate.

### `src/features/pages/Ward.astro`

- **Fallback `<p>` markup is duplicated** across the enabled and disabled
  ternary branches. Cosmetic now; it is the thing that drifts if the fallback
  ever gains markup. A single `<div>` with a computed attrs object removes it.
- **`data-ward-id` on the map container is vestigial.** The island reads only
  `boundaryUrl`, `mapsKey`, `mapsMapId`. It also lost its test assertion
  during the migration. It survives only in the enabled branch, which is a
  confusing asymmetry for an attribute nothing reads. Delete it.

### Dead ends left by the migration

- **`src/lib/geo.ts`'s `wardBoundaryUrl()` has no production caller left** —
  only `tests/unit/geo.test.ts`. It was the old `/data/gba.geojson#<ref>` URL
  builder.
- **`deploy/nginx/conf.d/site.conf`'s `location /data/gba.geojson`** now
  serves a 3.5 MB file nothing fetches. Harmless, but a future reader will
  infer a live path.

Both are worth one cleanup commit so the next reader is not misled.

### Performance and operations

- **`/ward/<id>/boundary.json` sets no `Cache-Control`.** nginx gives it 60s
  from `location /`. Ward geometry is immutable between delimitations, so a
  long `public, max-age` is free headroom for the election-day spike. The
  longer-TTL nginx route (extending the `site.conf:157` regex) was scoped out
  of the migration deliberately, because a change under `deploy/nginx/`
  triggers the runbook's special deploy path.
- **The kill switch is not instant.** Flipping `MAPS_ENABLED` off and
  restarting leaves up to 60s of nginx-cached ward HTML still carrying
  `data-ward-map` and the browser key. Whoever flips it under a budget alert
  should know that.
- **CSP widening is unconditional while the feature is gated.**
  `MAPS_ENABLED=false` sheds spend but not attack surface —
  `maps.googleapis.com` stays in `script-src` on every route. Scoping the
  hosts to `/ward/` (the `/partner-with-us` reCAPTCHA extension is the
  pattern) is now more attractive than it was, because the second consumer
  that justified base-policy placement never shipped.
- **`deploy/compose.local.yml` uses an explicit `environment:` block**, not
  `env_file`, so local development cannot enable maps without editing that
  file. Staging and production need no compose change.

### Documentation

- **`docs/gcp.md` §4 and §10 describe deleted code in the present tense** —
  §4 still calls `buildBaseStyle()` "current" (it was removed with the
  MapLibre island, and its test with it), and §10 is future-tense about work
  that has now shipped. The 2026-08-14 status note at the top of that file
  covers the Places deferral but not these. `CLAUDE.md` now points readers at
  this file.
- **`docs/project-dependencies.md` row 6.4's "Owner" column reads
  `resolved`** — a status word in a column labelled Owner.
- **`deploy/runbook.md`'s `GOOGLE_MAPS_BROWSER_KEY` row calls the fallback a
  "no-JS fallback".** The same markup is server-rendered regardless of JS, so
  the label is imprecise.

---

## The open design decision: Places Autocomplete

Scoped for this migration, **deferred, not merely postponed**. The reasoning
is in `docs/project-dependencies.md` §6.4 and `docs/gcp.md`'s status note.
Short version: the legacy `google.maps.places.Autocomplete` widget has been
unavailable to new customers since 2025-03-01, and legacy Places services are
unavailable in new Cloud projects — which `docs/gcp.md` §1 creates. It is
present and fully typed in `@types/google.maps`, so it typechecks and passes a
mocked test while doing nothing in a real browser.

Only `PlaceAutocompleteElement` is viable, and adopting it is a genuine fork:

- **(a) Swap the element in** after the library resolves, keeping the original
  `<input>` for the native POST and mirroring typed text back so the 6-digit
  pincode branch still works. Less code, Google-maintained accessibility;
  changed markup and fiddly mirroring.
- **(b) Autocomplete Data API** (`fetchAutocompleteSuggestions`) driving our
  own suggestion list against the existing input. Zero markup change, every
  current invariant preserved; meaningfully more code and we own the combobox
  accessibility.

Both add a second billed `fetchFields` per selection.

This matters because it is the platform's primary user journey (PRD §5.1) and
because today's address lookup dead-ends: `results.length !== 1 ||
partial_match` → `ambiguous` → `use_pincode` → `data/pincode-wards.json`,
still a 12-row placeholder.

`docs/gcp.md` §2's choice of **Places API (New)** was already correct in
anticipation, so nothing in the provisioning steps changes when this lands.
