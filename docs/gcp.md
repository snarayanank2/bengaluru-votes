# Google Cloud provisioning

**Status:** Written 2026-08-13, ahead of the all-Google maps migration.

Dependency register reference: `docs/project-dependencies.md` §6.2 (Cloud
project + billing), §6.3 (Geocoding key), §6.4 (Maps Platform terms), §6.5
(geocoding budget + quota alerts), §6.10 (secrets custody), §6.12 (GA
property), §6.13 (reCAPTCHA keys), §6.19 (Cloud Storage bucket for affidavit
PDFs — added 2026-08-15, provisioning not yet written up here). Operational
context: `deploy/runbook.md` §"Required environment variables" — the table
there is the authority on what each variable does at runtime; this document
is how the values in it are obtained.

This covers **credential procurement only**. Wiring the browser key into the
app, replacing the MapLibre island, and widening the CSP were separate work,
now shipped; §10 below records what changed and why.

Console labels drift. Treat navigation paths as approximate and **API names
as exact** — several Google APIs differ only by a suffix and bill under
separate SKUs.

**Status update, 2026-08-14:** the `google-maps-migration` branch shipped the
Maps JavaScript API ward-boundary map, the booth directions link-outs, **and**
Places Autocomplete on the ward lookup — all three, not two of three.

The legacy `google.maps.places.Autocomplete` widget genuinely could not be
used: it has been unavailable to new customers since 2025-03-01, and legacy
Places services are unavailable in a new Cloud project, which §1 below
creates. That part of the original assessment was right. What changed is the
resolution: `google.maps.places.PlaceAutocompleteElement`
(`src/islands/WardLookup.ts`) was adopted and is live — it replaces the
server-rendered `<input>` when the server renders a browser key, predictions
return biased to the GBA bbox and restricted to India, and it reads
`placePrediction.text` on selection without a second `fetchFields()` call (the
server still does the geocoding; the island never learns a position).

§2's choice of **Places API (New)** (not the legacy Places API) was correct
all along, and is no longer provisioning ahead of an uncalled feature: the
Places API restriction on Key B/C in §3 now backs a feature the app actually
calls, and Places metering is actually incurred, not merely anticipated.

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

**Trade-off worth recording.** `buildBaseStyle()` — the MapLibre-era
function that drew the basemap's flat background layer in code, versioned,
reviewed, and covered by tests — is gone; it was removed with the MapLibre
island during the migration, and its test with it. A Map ID moves that
styling into console state nothing in this repo can see or test. Whoever
changes the style should note it in a commit message even though no file
changes.

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
`src/lib/budgets.ts` enforces the daily cap; exhausting it returns
`unavailable` (`reason: 'budget'`) to every citizen who tries a ward lookup.
Pincode lookup was removed 2026-08-14, so there is no fallback left —
exhausting this budget doesn't degrade ward lookup, it takes the platform's
primary user journey down entirely, city-wide, until the next day's budget
resets. A GCP quota simply starts erroring, and the map breaks for every
visitor at once. So set the quota high — a circuit breaker against runaway
spend, not a traffic control — and treat the budget alert as the signal that
actually matters: it's the only guard standing between normal operation and
ward lookup going dark.

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

**Done 2026-08-14** — the property exists and production runs
`GA_MEASUREMENT_ID=G-PZQJ1ZSCN0`.

Leave it unset on staging. Per the runbook table, unset means GA is simply
absent — no error, no script tag.

§6.12 requires the tracker disclosed in `/privacy` before it ships, alongside
reCAPTCHA.

## 8. Programmable Search engine ID — **dead, 2026-08-15**

This section provisioned a Programmable Search engine and
`GOOGLE_SEARCH_CX` / `GOOGLE_SEARCH_API_KEY` for **candidate news-link
suggestions**. That feature was dropped from the plan on 2026-08-15 and its
dependency row (formerly `project-dependencies.md` §6.15) was deleted with
it. **Do not provision these keys.** Nothing in the milestones needs them,
and the register no longer carries a row to point at.

Kept as a stub rather than removed so the section numbering below does not
shift under anything citing it.

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

## 10. What changed in the app because of this

Written ahead of the migration as a preview of what would fail first if
missed. All of it shipped 2026-08-14; kept here as a record of what to check
if any of this regresses, not as a to-do list.

**The browser key is not a `PUBLIC_*` variable.** Astro inlines `PUBLIC_*` at
build time, which is the same footgun `CLAUDE.md` documents for
`SITE_ORIGIN`: an image built without the value would serve every GET a
healthy 200 and a broken map, with nothing in `docker compose ps`, the
healthcheck, or the logs to say so. The key and Map ID reach the browser as
`data-*` attributes from server frontmatter instead —
`src/features/pages/Ward.astro` and `Home.astro` render them,
`src/lib/maps-config.ts` gates them behind `mapsConfig().enabled`, and the
islands read them off `container.dataset` / `form.dataset`. Both values stay
runtime config a container restart can change.

**CSP widening** (`src/lib/csp.ts`, `tests/unit/csp.test.ts`). Shipped, and
wider than originally scoped — the base policy now carries, all verified in a
real browser: `https://maps.googleapis.com` and `https://maps.gstatic.com`
across `script-src`, `connect-src` and `img-src`; `https://fonts.googleapis.com`
in `style-src` and `https://fonts.gstatic.com` in `font-src` for the fonts the
Maps JS UI loads; and — the non-obvious one — `https://places.googleapis.com`
in `connect-src`. Places API (New) posts its autocomplete RPCs to that host,
**not** `maps.googleapis.com`; without it every keystroke in the autocomplete
box was silently blocked and suggestions never appeared, with no console
error pointing at CSP as the cause. `worker-src 'self' blob:` predates the
migration (it was MapLibre's) and Maps JS needs it too, so that line stayed
as-is; its comment was updated to stop describing it as MapLibre-specific.

**The island's failure-closed contract held.** `mountWardMap()` returns
without touching the container on any failure, leaving the server-rendered
fallback text in place. Google's loader fails differently from MapLibre's did
— async script load, `window.gm_authFailure` firing after a successful load —
and both are handled: a rejected loader promise is caught before the
container is cleared, and `gm_authFailure` restores the fallback afterward if
Google rejects the key post-load. See `docs/superpowers/plans/2026-08-14-google-maps-followups.md`
for the follow-ups still open against this contract (handler installation
order, a re-entrancy guard, a coordinate shape guard).

**`geocode.ts`'s no-coordinates rule stayed, on privacy grounds.** §6.4's
restriction — Google Maps content may not be used in an app displaying a
non-Google map — is what the file's header block originally defended
against, and rendering IS Google now, so that argument no longer applies. The
rule was kept anyway because it is also a privacy property: `geocode_cache`
stores normalized address → ward ID and has never held a citizen's location.
The file's header now says so explicitly. Removing it remains a separate
decision with its own DPDP argument, not a cleanup this migration made.

**§6.4 is closed.** Once rendering is Google, the register's open question —
"whether the geocoding architecture is licensed at all" — no longer has a
case to answer. `docs/project-dependencies.md` §6.4 records this; that file
is out of scope for this document to edit further.
