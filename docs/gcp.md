# Google Cloud provisioning

**Status:** Written 2026-08-13, ahead of the all-Google maps migration.

Dependency register reference: `docs/project-dependencies.md` §6.2 (Cloud
project + billing), §6.3 (Geocoding key), §6.4 (Maps Platform terms), §6.5
(geocoding budget + quota alerts), §6.10 (secrets custody), §6.12 (GA
property), §6.13 (reCAPTCHA keys), §6.15 (Programmable Search). Operational
context: `deploy/runbook.md` §"Required environment variables" — the table
there is the authority on what each variable does at runtime; this document
is how the values in it are obtained.

This covers **credential procurement only**. Wiring the browser key into the
app, replacing the MapLibre island, and widening the CSP are separate work;
§10 below lists what changes and why.

Console labels drift. Treat navigation paths as approximate and **API names
as exact** — several Google APIs differ only by a suffix and bill under
separate SKUs.

**Status update, 2026-08-14:** the `google-maps-migration` branch shipped the
Maps JavaScript API ward-boundary map and the booth directions link-outs.
Places Autocomplete on the ward lookup did **not** ship — it was deferred,
not merely postponed. The legacy `google.maps.places.Autocomplete` widget has
been unavailable to new customers since 2025-03-01 and legacy Places services
are unavailable in a new Cloud project, which §1 below creates; only
`PlaceAutocompleteElement` is viable, and adopting it is an unresolved design
decision. §2's choice of **Places API (New)** (not the legacy Places API) was
already correct in anticipation of this — nothing in the provisioning steps
below needs to change when autocomplete eventually lands. Until then, the
Places API restriction on Key B/C in §3 provisions for a feature the app does
not yet call.

---

## 0. What you end up with

| # | Credential | Console | Env var | New? |
|---|---|---|---|---|
| A | Server key — Geocoding | Cloud | `GOOGLE_GEOCODING_API_KEY` | existing |
| B | Browser key — production | Cloud | `GOOGLE_MAPS_BROWSER_KEY` | **new** |
| C | Browser key — staging | Cloud | `GOOGLE_MAPS_BROWSER_KEY` (staging env file) | **new** |
| D | Server key — Custom Search | Cloud | `GOOGLE_SEARCH_API_KEY` | existing |
| — | Map ID (cloud styling) | Cloud | `GOOGLE_MAPS_MAP_ID` | **new** |
| — | Programmable Search engine ID | PSE | `GOOGLE_SEARCH_CX` | existing |
| — | reCAPTCHA v3 pair | reCAPTCHA admin | `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` | existing |
| — | GA4 measurement ID | Analytics | `GA_MEASUREMENT_ID` | existing |

Three separate consoles. Steps 1–5 are the new work; steps 6–8 exist already
and are recorded here so one document covers every Google credential the
platform holds.

---

## 1. Project and billing (§6.2)

Sign in as **the organisation's account, not a personal one.** §6.10 (secrets
custody) is unassigned; a project owned by an individual's Google account
becomes unrecoverable when that person leaves, and it cannot be transferred
without their cooperation.

1. `console.cloud.google.com` → project picker → **New Project**.
   Name: `bengaluru-votes`. Record the **Project ID** — auto-generated,
   distinct from the display name, and what every later screen keys on.
2. **Billing → Link a billing account** → create one with the organisation's
   card and GST details.

   Indian billing accounts want the GST number at creation. Adding it to an
   existing account means a support ticket.
3. Confirm the project page shows a linked billing account before going on.
   Without it, API enablement partially succeeds and keys return
   `BillingNotEnabledMapError` at request time rather than at setup time.

## 2. Enable the APIs

**APIs & Services → Library**, search and **Enable** each:

| API | For | State |
|---|---|---|
| **Geocoding API** | address → ward (`src/lib/geocode.ts`) | already in use |
| **Maps JavaScript API** | the ward map renderer | new |
| **Places API (New)** | address autocomplete on the ward lookup | new |
| **Maps Static API** | pre-rendered ward images for `/partner-kit` | optional |
| **Custom Search API** | news-link suggestions (`jobs/news-suggest.ts`) | already in use |

Note **Places API (New)**. The legacy Places API is a separate product with a
separate SKU and a different client surface; enabling the wrong one produces
authorisation errors that read like key misconfiguration.

## 3. Create the four keys

**A key carries exactly one application restriction.** Server calls need an
IP restriction and browser calls need an HTTP referrer restriction, so a
single key cannot serve both. Hence four keys, not one.

Get the box's egress IP first — staging and production share it:

```sh
ssh root@<vps> 'curl -s ifconfig.me'
```

For each key: **APIs & Services → Credentials → Create credentials → API
key**, then **Edit API key** immediately. An unrestricted key is a billable
key that anyone who obtains it can spend against your card.

### Key A — `bv-prod-server`

- Application restriction: **IP addresses** → the VPS egress IP
- API restriction: **Geocoding API** only
- → `GOOGLE_GEOCODING_API_KEY` in the production env file

### Key B — `bv-prod-browser`

- Application restriction: **HTTP referrers** → `https://bengaluruvotes.opencity.in/*`
- API restriction: **Maps JavaScript API**, **Places API (New)** (add **Maps
  Static API** if step 2 enabled it)
- → `GOOGLE_MAPS_BROWSER_KEY` in the production env file

### Key C — `bv-staging-browser`

- Application restriction: **HTTP referrers** →
  `https://staging-bengaluruvotes.opencity.in/*`, `http://localhost:4321/*`
- API restriction: same as Key B
- → `GOOGLE_MAPS_BROWSER_KEY` in the staging env file

Staging gets its own key deliberately. Commit `7782078` removed staging's
basic auth, so staging is publicly reachable and its browser key is
scrapeable by anyone who loads the page. A separate key can be revoked or
quota-capped without touching production.

This does **not** conflict with the staging-isolation rule in `CLAUDE.md`
("staging must keep `SENDS_DISABLED=true` with vendor keys omitted
entirely"). That rule is about messaging vendors — anything that can reach a
real citizen's phone or inbox. A maps key sends nothing; it bills. Keep
`SENDS_DISABLED=true` and keep Twilio/SendGrid omitted.

### Key D — `bv-prod-search`

- Application restriction: **IP addresses** → the VPS egress IP
- API restriction: **Custom Search API** only
- → `GOOGLE_SEARCH_API_KEY` in the production env file

Separate from Key A so the two can be rotated independently and so per-key
quota graphs attribute spend to the right feature.

Restrictions take several minutes to propagate. A key that 403s immediately
after editing usually just needs the wait.

## 4. Map ID and map style

> **Step 1 was deliberately skipped, 2026-08-14.** A Map ID exists and is
> required for the map to render, but **no style is bound to it**, so
> production serves a stock full-colour Google basemap with business POIs and
> Google's own red place markers. That was a decision, not an oversight —
> maintaining a cloud style is unversioned console work — and it is recorded
> in `docs/design-system.md` §8.1. The steps below remain correct if it is
> ever revisited; the change is console-side and needs no deploy.

Cloud-based styling is how `docs/design-system.md` §8 ("desaturated gray
basemap … no red pins, no party-colored anything on maps") would be satisfied
without hardcoding color, and `mapId` is required for a style to apply.

1. **Google Maps Platform → Map Styles → Create style.** Start from
   **Silver**. Reduce POI density, disable business POIs, mute road and
   transit color.

   The intent was that nothing on a ward map should read as
   party-affiliated and no marker should be red. Only the half the platform
   controls is currently enforced — see the note above and
   `design-system.md` §8.1.
2. **Map Management → Create Map ID** → type **JavaScript** → associate the
   style from step 1.
3. Record the Map ID → `GOOGLE_MAPS_MAP_ID`. It is not a secret; it ships to
   the browser next to the key.

Create a second Map ID for staging if you want to iterate on the style
without changing production mid-campaign.

**Trade-off worth recording.** The current `buildBaseStyle()`
(`src/islands/WardMap.ts`) is style-as-code: versioned, reviewed, and
covered by `tests/unit/ward-map-island.test.ts` and the hex-literal ban in
`tests/unit/tokens.test.ts`. A Map ID moves that styling into console state
nothing in this repo can see or test. Whoever changes the style should note
it in a commit message even though no file changes.

## 5. Quota caps and budget alerts (§6.5, §6.11)

Do this **before** the keys reach production.

1. **APIs & Services → [each API] → Quotas & System Limits** → set a daily
   request cap on:
   - Maps JavaScript API — map loads
   - Places API (New) — autocomplete requests
   - Geocoding API — requests
2. **Billing → Budgets & alerts → Create budget** → thresholds at 50 / 90 /
   100% → notify an inbox someone reads. §6.14 notes monitoring is partially
   unresolved; do not route this to an address that only exists in a doc.

**A quota cap is not the same guard as `GEOCODE_DAILY_BUDGET`.**
`src/lib/budgets.ts` degrades: exhausting the geocode budget returns
`use_pincode` and the citizen still gets an answer. A GCP quota simply starts
erroring, and the map breaks for every visitor at once. So set the quota high
— a circuit breaker against runaway spend, not a traffic control — and treat
the budget alert as the signal that actually matters.

Add an application-level kill switch alongside it: an env var that suppresses
the map island entirely, so cost can be shed with a container restart instead
of a rebuild and redeploy. This is the analogue of the geocode budget for the
client-side spend, and nothing in Google's console provides it.

## 6. reCAPTCHA v3 (§6.13) — separate console

`src/lib/recaptcha.ts:52` posts to
`https://www.google.com/recaptcha/api/siteverify`, the **classic** endpoint.
Register **classic reCAPTCHA v3**, not reCAPTCHA Enterprise — Enterprise
keys do not verify against that endpoint, and the failure looks like an
invalid secret.

`google.com/recaptcha/admin` → **+** → **reCAPTCHA v3** → domains:
`bengaluruvotes.opencity.in`, `staging-bengaluruvotes.opencity.in`,
`localhost` → yields `RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY`.

Used on exactly one route: the anonymous `POST /api/eoi` behind
`/partner-with-us`. Disclose it in `/privacy` before it ships.

## 7. Google Analytics 4 (§6.12) — separate console

`analytics.google.com` → **Admin → Create property** → **Web** data stream
for `https://bengaluruvotes.opencity.in` → copy the **Measurement ID**
(`G-…`) → `GA_MEASUREMENT_ID`.

Leave it unset on staging. Per the runbook table, unset means GA is simply
absent — no error, no script tag.

§6.12 requires the tracker disclosed in `/privacy` before it ships, alongside
reCAPTCHA.

## 8. Programmable Search engine ID (§6.15)

`programmablesearchengine.google.com` → **Add** → "Search specific sites",
seeded from `data/news-domains.json` → copy the **Search engine ID** →
`GOOGLE_SEARCH_CX`.

`jobs/news-suggest.ts` no-ops (logs, exits 0) until both this and
`GOOGLE_SEARCH_API_KEY` are set.

## 9. Custody and placement (§6.10)

| Where | File | Mode |
|---|---|---|
| Production | `/etc/bengaluru-votes/.env.production` (outside both checkouts) | 600 |
| Staging | `deploy/.env.staging` | 600 |

`.gitignore`'s `.env.*` rule keeps both out of the repo. Nothing in this
document's key values belongs in a commit, a task description, or a chat log.

Record, somewhere durable and outside this repo: who holds the Google account
recovery, who is Billing Administrator, and who can rotate the keys. That is
what §6.10 asks for, and it is still unassigned.

---

## 10. What changes in the app after this

Not part of provisioning, but the things that will fail first if they are
missed.

**The browser key must not be a `PUBLIC_*` variable.** Astro inlines
`PUBLIC_*` at build time, which is the same footgun `CLAUDE.md` documents for
`SITE_ORIGIN`: an image built without the value serves every GET a healthy
200 and a broken map, with nothing in `docker compose ps`, the healthcheck,
or the logs to say so. Pass the key and Map ID from server frontmatter onto
the map container as data attributes instead — `src/features/pages/Ward.astro`
already does this with `data-boundary-url`, the island already reads
`container.dataset`, and both values stay runtime config that a container
restart can change.

**CSP widening** (`src/lib/csp.ts`, `tests/unit/csp.test.ts`). Maps JS needs
`https://maps.googleapis.com` and `https://maps.gstatic.com` across
`script-src`, `connect-src` and `img-src`. `worker-src 'self' blob:` is
already present for MapLibre and Maps JS needs it too, so that line stays as
is — but its comment, which currently explains the directive as
MapLibre-specific, will be wrong.

**The island's failure-closed contract is worth keeping.** `mountWardMap()`
returns without touching the container on any failure, leaving the
server-rendered no-JS fallback text in place. Google's loader fails
differently (async script load, `gm_authFailure`), so preserving that
behaviour takes deliberate handling rather than the current try/catch.

**`geocode.ts`'s no-coordinates rule is no longer legally required, and
should stay anyway.** §6.4's restriction — Google Maps content may not be
used in an app displaying a non-Google map — is what the file's header block
is defending against, and an all-Google stack dissolves it. But the rule is
also a privacy property: `geocode_cache` stores normalized address → ward ID
and has never held a citizen's location. Removing it is a separate decision
with its own DPDP argument, not a cleanup that falls out of this migration.
If it is ever revisited, rewrite that header block rather than deleting it.

**§6.4 can be closed.** Once rendering is Google, the register's open
question — "whether the geocoding architecture is licensed at all" — no
longer has a case to answer. Update `docs/project-dependencies.md` §6.4
rather than leaving it open and stale, and note there that adding Places
autocomplete brings its own metering (the register already anticipates this
at §6.4's last paragraph).
