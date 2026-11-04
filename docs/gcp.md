# Google Cloud provisioning (production)

Checklist for obtaining every Google credential production uses. What each
variable does at runtime is defined by the env table in `deploy/runbook.md`
("Required environment variables"); this document is how the values are
obtained.

Console labels drift: treat navigation paths as approximate and **API names
as exact** — several Google APIs differ only by a suffix and bill under
separate SKUs.

## 0. What you end up with

| # | Credential | Console | Env var |
|---|---|---|---|
| A | Server key — Geocoding | Cloud | `GOOGLE_GEOCODING_API_KEY` |
| B | Browser key — Maps JS + Places | Cloud | `GOOGLE_MAPS_BROWSER_KEY` |
| — | Map ID (cloud styling) | Cloud | `GOOGLE_MAPS_MAP_ID` |
| — | reCAPTCHA v3 pair | reCAPTCHA admin | `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` |
| — | GA4 measurement ID | Analytics | `GA_MEASUREMENT_ID` |

Also set `MAPS_ENABLED=true` (§5) and `GEOCODE_DAILY_BUDGET` (§5).

## 1. Project and billing

Use **the organisation's Google account, not a personal one** — a project
owned by an individual becomes unrecoverable when they leave.

1. `console.cloud.google.com` → **New Project** `bengaluru-votes`. Record the
   **Project ID** (distinct from the display name).
2. **Billing → Link a billing account** with the organisation's card and GST
   number. Indian billing accounts want GST at creation; adding it later
   needs a support ticket.
3. Confirm the billing link before continuing. Without it keys fail at
   request time with `BillingNotEnabledMapError`.

## 2. Enable the APIs

**APIs & Services → Library → Enable**:

| API | Used by |
|---|---|
| **Geocoding API** | address → ward, server side (`src/lib/geocode.ts`) |
| **Maps JavaScript API** | ward boundary map (`src/islands/WardMap.ts`) |
| **Places API (New)** | address autocomplete, `PlaceAutocompleteElement` (`src/islands/WardLookup.ts`) |

Enable **Places API (New)**, not the legacy Places API: the legacy product is
unavailable to new projects, and the wrong one produces errors that look like
key misconfiguration.

## 3. Create the keys

A key carries exactly one application restriction, so the server key (IP)
and browser key (HTTP referrer) must be separate.

Get the VPS egress IP: `ssh root@<vps> 'curl -s ifconfig.me'`.

For each: **APIs & Services → Credentials → Create credentials → API key**,
then **Edit API key** immediately — an unrestricted key is spendable by anyone
who obtains it.

| Key | Application restriction | API restriction | Env var |
|---|---|---|---|
| A `bv-prod-server` | IP addresses → VPS egress IP | Geocoding API only | `GOOGLE_GEOCODING_API_KEY` |
| B `bv-prod-browser` | HTTP referrers → `https://bengaluruvotes.opencity.in/*` | Maps JavaScript API, Places API (New) | `GOOGLE_MAPS_BROWSER_KEY` |

For local development use a separate browser key restricted to
`http://localhost:4321/*`; never add localhost to Key B.

Restrictions take several minutes to propagate; a 403 right after editing
usually just needs the wait.

The browser key and Map ID are read at request time and passed to islands as
`data-*` attributes (`src/lib/maps-config.ts`); never make them `PUBLIC_*`
variables, which Astro inlines at build time.

## 4. Map ID and map style

`mapId` is required for the map to render (`mapsConfig().enabled` checks it)
and is how a cloud style is applied. No style is currently bound, so
production shows the stock Google basemap (`docs/design-system.md` §8.1).

1. **Map Management → Create Map ID** → type **JavaScript** → record it as
   `GOOGLE_MAPS_MAP_ID`. It is not a secret.
2. To style (optional, console-only, no deploy): **Map Styles → Create
   style** from **Silver**, disable business POIs, mute road/transit colour,
   then associate it with the Map ID. Note any style change in a commit
   message, since the repo cannot see it.

## 5. Quota caps and budget alerts

Do this before keys reach production.

1. **APIs & Services → [API] → Quotas & System Limits** → daily request cap on
   Maps JavaScript API (map loads), Places API (New) (autocomplete requests)
   and Geocoding API.
2. **Billing → Budgets & alerts → Create budget** → alerts at 50 / 90 / 100%
   to an inbox someone reads.

Set GCP quotas **high** — a circuit breaker against runaway spend, not traffic
control: a hit quota breaks the map and lookup for everyone at once. The
budget alert is the real signal. Responses when it fires:

- **Client-side spend** (Maps JS, Places): set `MAPS_ENABLED` to anything but
  `true` and restart the container; map and autocomplete fall back to
  server-rendered markup (`src/lib/maps-config.ts`).
- **Geocoding**: `GEOCODE_DAILY_BUDGET` (`src/lib/budgets.ts`) caps calls per
  day. Exhausting it returns `unavailable` for every ward lookup until the next
  day — there is no fallback path to a ward.

## 6. reCAPTCHA v3 — separate console

`src/lib/recaptcha.ts` verifies against the **classic** endpoint
`https://www.google.com/recaptcha/api/siteverify`. Register **classic
reCAPTCHA v3**, not reCAPTCHA Enterprise (Enterprise keys fail there with what
looks like an invalid secret).

`google.com/recaptcha/admin` → **+** → **reCAPTCHA v3** → domains
`bengaluruvotes.opencity.in`, `localhost` → `RECAPTCHA_SITE_KEY`,
`RECAPTCHA_SECRET_KEY`.

Verified on the anonymous write routes `PUT /api/issue-votes` and
`POST /api/flags` (candidate-field flags, action `candidate_flag`), each with
its own action. Provider
errors fail closed, so keep quota adequate.

## 7. Google Analytics 4 — separate console

`analytics.google.com` → **Admin → Create property** → **Web** data stream for
`https://bengaluruvotes.opencity.in` → Measurement ID (`G-…`) →
`GA_MEASUREMENT_ID`. Production uses `G-PZQJ1ZSCN0`.

Set it only in production; unset means no GA script tag and no error.

## 8. Custody and placement

| Where | File | Mode |
|---|---|---|
| Production | `/etc/bengaluru-votes/.env.production` (outside the checkout) | 600 |

`.gitignore`'s `.env.*` rule keeps it out of the repo. Key values never go in
a commit, task description or chat log.

## Open questions

- Who holds Google account recovery, who is Billing Administrator, and who can
  rotate keys is unassigned. Record it somewhere durable outside this repo.
