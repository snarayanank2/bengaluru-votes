# Production Architecture

What runs where, what is cached, what is dynamic, and how the site stays fast, bilingual, indexable and secure on a single VM with no CDN. Section numbers are cited from code comments; keep them stable.

---

## 1. Context & constraints

- **Hosting:** one Hostinger VPS in Mumbai running Docker Compose, production only (§14). No CDN.
- **Traffic:** overwhelmingly anonymous and read-only, spiking near polling day. Content changes when staff publish, not per request. Citizens never log in; login is staff-only (admin, curator, transcriber).
- **Team:** TypeScript/Node.
- **SEO/AEO is a requirement:** ward, candidate and guide pages must be indexable and quotable, in English and Kannada.
- **External services** (full list and gaps: §16): Google Geocoding (server-side), Google Maps JavaScript API for the ward-boundary map and Places Autocomplete (`google.maps.places.PlaceAutocompleteElement`, Places API (New), `src/islands/WardLookup.ts`) on the ward-lookup input; the BBMP electoral API for booth lookup by EPIC (`src/lib/electoral-api.ts`); Anthropic for Kannada machine translation and affidavit extraction; reCAPTCHA v3 on anonymous writes; Google Analytics (client-side snippet on public, indexable pages; static markup, so it does not break the one-variant-per-URL rule in §5).

## 2. Decision summary

| Decision | Choice |
|---|---|
| Application | One **Astro SSR monolith** (Node adapter, TypeScript): public pages, API endpoints, curator/admin/transcriber screens |
| Database | One **Postgres 16** instance, accessed via Drizzle |
| Edge | **nginx**: TLS, static files, per-IP rate limiting, **micro-cache** for anonymous page GETs |
| Jobs | A **cron container** sharing the app image (translation retries, sitemap regeneration, flag-abuse cleanup) plus a long-running **extraction worker** |
| Language URLs | English at root, **Kannada under `/kn/`**, hreflang-linked; the toggle navigates between them |
| Spike strategy | nginx micro-cache (~60 s TTL on pages); no purge machinery |
| Geo | Ward polygons as static GeoJSON (`data/gba.geojson`); the map island fetches one ward's Feature from `GET /ward/<id>/boundary.json` (`src/pages/ward/[id]/boundary.json.ts`, `wardBoundaryFeature()` in `src/lib/geo.ts`); in-memory point-in-polygon (Turf.js) for address lookup; **no PostGIS** |
| Client JS | Zero by default; islands only for modals, the map, lookups and voting |
| Deployment | Hostinger VPS; images built on the box from a tagged checkout; GitHub Actions tests every PR and deploys every push to `main` (§14) |
| Migrations | **Drizzle SQL migrations**, forward-only and backward-compatible, run as an explicit deploy step (§14.7) |
| Media | **One store**: affidavit PDFs are `bytea` in Postgres (`media`), served at immutable content-hashed URLs. No object storage, no bucket credential |
| Monitoring | None external. Container healthchecks and rotated Compose logs only (§10, §16) |

Rejected alternatives: a Next.js monolith with ISR (heavier runtime, React hydration on every page) and a fully static build plus separate API (publish-immediately becomes a rebuild pipeline; one deployable becomes two).

## 3. System overview

One Compose project (`deploy/compose.production.yml`), five long-running services:

| Service | Role |
|---|---|
| `nginx` | TLS termination; serves `/_astro/*` and `/data/gba.geojson` from the static volume; micro-cache for anonymous HTML and `/media/`; `limit_req` zones; static security headers (§13). Only service on the `front` network |
| `app` | Astro SSR (Node). All routes: public pages, `/api/*`, `/curator/*`, `/admin/*`, `/transcribe/*`, `/login`, `/media/*` |
| `postgres` | The single database (`pg_data_prod` volume) |
| `jobs` | `supercronic` running `deploy/crontab` (§10) |
| `extract-worker` | `jobs/extract-affidavits.ts`: claims queued affidavits and reads them with Claude (§6). Exits at once without `ANTHROPIC_API_KEY`; `restart: on-failure:5` |

Plus two helpers: **`certbot`** (renewal loop, shares the cert and webroot volumes with nginx, §14.5) and **`static-init`**, a one-shot that copies the image's static build onto the nginx volume. It does not re-run on `up -d`, so `deploy/deploy.sh` re-runs it on every deploy (§14.4).

No Redis, no queue, no separate API service. Nothing the platform serves lives off the VM.

## 4. Routing & rendering

- Public pages are server-rendered to complete HTML with **zero client JavaScript by default**. Public islands: the Flag modal (`src/islands/FlagModal.ts`); inline issue voting (`IssueVote.ts`); the ward map (`WardMap.ts`, rendered only when `mapsConfig().enabled`, `src/lib/maps-config.ts`); the address lookup with Places Autocomplete (`WardLookup.ts`); the booth lookup (`BoothLookup.ts`); ward section navigation and copy buttons. Staff screens add `AffidavitFields.ts` and `TranscribeForm.ts`.
- **Public routes:** `/`, `/ward/{id}`, `/ward/{id}/candidates`, `/ward/{id}/compare`, `/ward/{id}/boundary.json`, `/candidate/{slug}`, `/about`, `/about-election`, `/voter-faqs`, `/privacy`, `/terms`, `/llms.txt`, `/robots.txt`, `/healthz`.
- **Candidate pages show the stored affidavit PDF beside the report card** on wider screens, framed from `/media/` (CSP: §13).
- **Language:** every public page exists twice — `/ward/57` and `/kn/ward/57` — via Astro i18n routing. The app-bar toggle links to the same page in the other language. Every page emits `hreflang` alternates and `x-default`. There is no server-side language variant.
- Curator, admin and transcriber screens are server-rendered forms with standard POSTs in the same app — no SPA. Staff sign in at `/login`; staff sign-in is being reworked to per-staff passwords in a separate change.
- Modals are progressive enhancements over real routes.

## 5. Caching & the election-day spike

nginx `proxy_cache` on anonymous-shaped GET HTML (`deploy/nginx/conf.d/site.conf`):

- Public pages: **60 s TTL**. `/media/`: 30 days. `/api/*`, `/curator/*`, `/admin/*`, `/transcribe/*`, `/login`: never cached. Issue-vote results are fetched from an uncached API only after the browser has voted.
- **Invariant: public page HTML never varies by session.** A signed-in staff member receives the same cached anonymous markup; anything per-visitor comes from an uncached API (`GET /api/issue-votes` with its opaque HttpOnly receipt cookie). **nginx strips the `Cookie` header** before proxying public routes and ignores upstream `Set-Cookie`, so only uncached APIs see a cookie. Each URL has exactly one cached variant per language. Guarded by `tests/routes/cache-invariant.test.ts`.
- **The cache key ignores the query string** (`$scheme$host$uri`) — unknown params can neither fragment the cache nor bust it into a DoS on the origin.
- Worst-case origin load is every public URL rendered once per TTL — about 4,000 renders/minute at the ceiling (369 wards × ~5 pages × 2 languages), well within one Node process. The spike lands on nginx.
- The 60 s window satisfies "edits go live immediately"; staff preview on uncached staff routes.
- **Stale-while-restart:** `proxy_cache_use_stale error timeout updating` plus `proxy_cache_background_update` — cached pages keep serving through an app restart (§14.4) and brief origin failures. Only uncached paths blip.
- **Ward boundaries are deliberately not under `/api/`.** `location /api/` is uncached and shares a `limit_req` zone with the write endpoints; `/ward/<id>/boundary.json` falls into the cached, cookie-stripped public location, so a ~10 KB Feature is served from cache on every ward pageview instead of re-serialized per view and counted against a write-sized rate limit. Not localized: there is no `/kn/` twin.
- **Media** is served at immutable content-hashed URLs (`/media/{id}/{hash}`, §7). An edit produces a new URL.
- **The Host header cannot poison the cache.** Every server-generated absolute URL (canonicals, `hreflang`, `og:url`, JSON-LD `@id`, sitemaps) derives from the configured origin (Astro `site`), never from the request. nginx proxies only its named server block with a pinned `Host`; a default server rejects unmatched hosts.
- A CDN added later would sit in front of nginx with the same cache headers; nginx would then take client IPs from `X-Forwarded-For` via `real_ip`, restricted to the CDN's ranges, so per-IP limits stay unspoofable.

## 6. Data model

Schema: `src/db/schema.ts`; migrations: `drizzle/`.

| Area | Tables |
|---|---|
| Wards | `wards` (id = corporation × 1000 + ward number, EN/KN names, corporation, zone, `boundary_ref`, assembly, population, reservation, facts source) · `ward_old_ward_overlaps` (pre-delimitation wards and published overlap, basis points) · `ward_key_areas` · `ward_candidate_questions` (five bilingual questions per ward) · `ward_issues` (20-item bilingual catalog copied to every ward, `catalog_key`) |
| Candidates | `candidates` (slug, ward, lifecycle `filed\|contesting\|rejected\|withdrawn`; English name/party columns are a search projection) · `candidate_fields` (below) |
| Affidavits | `media` (bytes, validated content type, sha256, size) · `candidate_affidavits` (the extraction queue, below) · `transcription_assignments` |
| Citizen contributions | `anonymous_issue_vote_sets` / `anonymous_issue_vote_selections` · `flag_items` / `flag_submissions` / `flag_admissions` / `flag_request_buckets` / `flag_metrics` |
| Staff | `users` (staff only: role `transcriber\|curator\|admin`, status `active\|banned\|erased`, email, language) · `sessions` |
| Operations | `app_settings` (election anchors, `low_confidence_threshold`, guide link-out URLs) · `geocode_cache` (normalized address → ward id only; null = out of coverage) · `budget_counters` (per-day counters: `geocode`, `epic_lookup`, `anonymous_vote`, …) |

Seeds: `npm run seed:wards` loads `data/gba.geojson` (369 wards), `data/ward-facts.json`, `data/city-issues.json` and `data/ward-candidate-questions.json`; `npm run seed:admin` creates the first admin.

**Issue voting.** An anonymous ballot is a row in `anonymous_issue_vote_sets` holding only a SHA-256 hash of an opaque browser receipt (unique city-wide) plus exactly three `anonymous_issue_vote_selections`; immutable once written. Deleting a ward issue cascades its selections.

**Candidate flags.** `flag_items` is one deduplicated queue item per target (`target_ref`, partial unique index while `pending`) with resolution and `resolved_value_hash`. `flag_submissions` holds each report (text, optional suggestion and source link, keyed `browser_hash`, optional `user_id`, `fingerprint`, spam moderation state); partial unique indexes stop one browser or account submitting twice to a pending item. `flag_admissions` and `flag_request_buckets` hold short-lived keyed hashes for allowance checks; `flag_metrics` holds hourly aggregate counters. Accepted only on the eight fields in `FLAGGABLE_FIELD_KEYS` (`src/lib/candidate-profile.ts`); `ward_field` and `ward_issue` targets survive in the enum for old rows, which curators can only dismiss. Admission rules: §7.

**`candidate_fields`** (one row per candidate × field key): `value_en`, `value_kn`, `value_data` (the structured value the text was rendered from; null only on rows written before values were structured), `not_declared` (a valid, complete answer), `unreadable` (nobody could read it from the scan; shown as unresolved), `authored_lang`, `translation_status` `pending|done|manual`, `source_url`, `source_type` `official|curator`, `ai_extracted`, `checked_by`, `checked_at`, `confirmed_ai` (kept the AI's value or changed it). The published value is whatever the row holds; the AI/checked state is a label on it, never a gate. `checked_by`/`checked_at` are written only by the transaction that publishes a checked value (`src/lib/affidavit-publish.ts`).

**There is no change history.** No audit log: a field row holds its current value and nothing behind it. §13 records what that costs.

**`candidate_affidavits`** is the extraction queue: candidate (**null until matched**), media, `sha256` (unique, so re-uploads are no-ops), `state` `queued|extracting|needs_matching|published|failed`, `attempts`, `lease_expires_at`, `extraction` (validated JSON), `confidence` (0–100), `failure`, `match_reason`, `match_note`, `transcribed_at`. The stored copy is the public source link for affidavit fields.

**From upload to public page.** An admin uploads PDFs at `/admin/affidavits` or with `npm run upload:affidavits`; each becomes a `queued` row. `extract-worker` claims rows under a 15-minute lease (`src/lib/affidavit-queue.ts`, `FOR UPDATE SKIP LOCKED`) and reads each with Claude (`src/lib/affidavit-extraction.ts`), which returns the report-card fields and the candidate's name, ward, party and gender. If the ward resolves to exactly one ward and no same-name candidate exists there, the candidate is created and every field published at once, labelled AI-extracted. Otherwise the row waits as `needs_matching` and nothing from it is public until a curator or admin picks the ward and confirms name and party. A failed call retries up to three times, then waits as `failed`; a failure is never published as *not declared*. **Known cost:** a wrong AI-read ward is public until a person reads that affidavit.

**Transcription.** `transcription_assignments` (affidavit, transcriber, state `open|submitted|abandoned`, `drawn_at`, `expires_at`, `closed_at`). An assignment is a **10-minute hold**, not ownership: past expiry the affidavit returns to the queue. One transcriber reads each affidavit; one required form-wide confirmation publishes all fields atomically, straight to `candidate_fields` with no staging. A field marked *cannot read* publishes as `unreadable` and is not counted as checked.

Invariants enforced in the database:

- **The queue draw is atomic and prioritized in one statement** (`src/lib/transcribe.ts`: `SELECT … FOR UPDATE SKIP LOCKED` feeding an `INSERT`): affidavits with an unreadable field first, then those below `low_confidence_threshold` (`app_settings`, default 70), then the rest, randomized within each tier. A partial unique index on open assignments per affidavit is the backstop. There is deliberately no unique index on (affidavit, transcriber), so a transcriber can pick up an expired assignment they started.
- **Check state is computed on write.** Nothing writes "checked by a person" independently of a person having checked it.

**Storage cost of PDFs in Postgres.** About 4,000 affidavits arrive in one burst in the nomination window, capped at 20 MB each, on a 193 GB disk shared with the nginx cache, logs and locally built images (§10). The nine 2023 Assembly fixtures average about 3.3 MB; measure on the first real files. PDFs pass through Node on first read only (nginx caches `/media/` 30 days).

**Ward data.** `data/gba.geojson` is the authoritative final delimitation: 369 polygons with corporation/zone/assembly/RO metadata and EN/KN names, served by nginx and loaded into app memory at boot for point-in-polygon. `data/ward-candidate-questions.json` derives from OpenCity's `ward_facts_questions.geojson`, mapped to GBA wards by unique normalized English name because the source's numeric ids repeat across corporations.

## 7. API surface & auth

Public endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/ward-lookup` | `{lat, lng}` (device location) → point-in-polygon → ward: no external call, no budget, nothing stored. `{address}` → server-side Google geocode → point-in-polygon → ward. Returns a ward or `out_of_coverage`/`ambiguous`/`unavailable`, **never coordinates** (`src/lib/geocode.ts`; a privacy rule — `geocode_cache` has never held a location). Daily budget `GEOCODE_DAILY_BUDGET` (default 2,000) stops address mode when exhausted |
| `POST /api/booth-lookup` | `{epic}` → BBMP electoral API `searchby-epic` (`src/lib/electoral-api.ts`, custom transport in `electoral-transport.ts` because upstream serves an incomplete TLS chain) → booth, voter name and our ward (`src/lib/booth-lookup.ts`, mapped via `electoral-wards.ts` with a point-in-polygon fallback). Name and EPIC are never logged, cached or stored; `no-store`. Daily cap `EPIC_DAILY_BUDGET` (default 5,000) |
| `POST /api/flags/identity` | Issues the signed 30-day HttpOnly `bv_flag_browser` receipt (SameSite=Strict). Never set on a page GET or in middleware |
| `POST /api/flags` | Anonymous candidate-field report (rules below) |
| `PUT /api/issue-votes` | Anonymous exactly-three ballot: reCAPTCHA action + score, receipt uniqueness, per-IP nginx `vote` zone, 8 KB body, strict payload, global daily circuit breaker (`ANONYMOUS_VOTE_DAILY_BUDGET`, default 50,000) |
| `GET /api/issue-votes` | Receipt status; returns ward counts and percentages only after that receipt has voted there |
| `GET /ward/{id}/boundary.json` | One ward's GeoJSON Feature; cached public route (§5) |
| `GET /media/{id}/{hash}` | Affidavit PDFs from Postgres at an immutable URL, long-TTL cached (§5); `Content-Type` from the validated stored type (§13). Frameable by this site's own pages only |

**Anonymous candidate reports.** Any visitor can report an error in one of the eight flaggable fields; the modal opens directly, with no sign-in. The app bounds the body at 32 KiB (nginx too), validates the target and source link, verifies reCAPTCHA (action `candidate_flag`, hostname, score ≥ 0.5 by default, provider errors fail closed in production), then deduplicates and checks allowances in one Postgres transaction under target and reporter advisory locks (`src/lib/flags.ts`, `src/lib/flag-abuse.ts`). Reports are anonymous only: no submission is linked to an account, even a signed-in staff member's. Defaults: 3 accepted reports per 10 minutes and 10 per 24 hours per browser (`FLAGS_REPORTER_BURST_LIMIT`, `FLAGS_REPORTER_DAILY_LIMIT`), 100 per 24 hours per network (`FLAGS_NETWORK_DAILY_LIMIT`); nginx `flags` zone 10 requests/minute/IP, burst 5. `FLAGS_ABUSE_SECRET` keys the browser and network hashes; with `FLAGS_TRUST_PROXY=true` the app trusts only nginx's overwritten `X-Flag-Client-IP` (`src/lib/flag-http.ts`). An exact repeat of a report resolved within seven days on an unchanged value is acknowledged without attaching a new reporter. Reports and counts stay private and never change data automatically; counts are not identities. `FLAGS_SUBMISSIONS_PAUSED=true` refuses new submissions during an attack. `jobs/flag-cleanup.ts` expires abuse metadata daily.

**Curator screens** (`/curator/*`, curator or admin). `/curator` is the dashboard with search by candidate name or ward. `/curator/queue` and `/curator/queue/{id}` are the flag queue: the stored affidavit beside a fix form; curators can fix, reject, or mark selected submissions as spam (other active submissions keep the item open; an item with no active submission closes as rejected). Queue pages hold 50 items, submission pages 20. `/curator/candidate/{id}` is the candidate editor, `/curator/candidate/new?ward={id}` creates one, `/curator/ward/{id}` lists a ward's candidates, `/curator/ward/{id}/issues` edits ward issues, `/curator/matching` and `/curator/matching/{id}` are the needs-matching list (pick the ward, confirm name and party). `/curator/guide` is onboarding.

**Curators edit through the same structured inputs as transcribers.** `publishAffidavitFields` (`src/lib/affidavit-publish.ts`) is the only writer of field values — for the extraction worker, a transcriber's save, a confirmed match, an accepted flag and the candidate editor alike. A ward is changed by `moveCandidateWard`. Every curator publish carries a required confirmation tick, re-checked on the server. The editor has no status, upload or photo controls and rejects those POST actions.

**Transcription screens** (form-posting pages, desktop only). `POST /transcribe` (action `start`) assigns the next affidavit in priority order (§6) and redirects to `/transcribe/{assignment-id}`; there, `save` publishes the confirmed form in one transaction, `release` gives it back, `report` sends it to the matching list with a note. `/transcribe/guide` is onboarding. Middleware admits transcribers and admins; beyond that, authorization is "an open, unexpired assignment with this id belongs to this caller", checked on every read and write — anything else is a 404, for an admin too. These are the platform's only assignment-scoped writes.

**Admin screens** (`/admin/*`, admin only). `/admin` shows console counts and flag-abuse counters (accepted, duplicates, CAPTCHA failures, rate-limit refusals, spam, backlog and oldest age, volume-spike warning). `/admin/affidavits`: bulk upload, counts by state, needs-matching list, failed list with retry and discard. `/admin/users`: the staff list (every account is staff), role changes, ban/reactivate, removing staff access and the erasure routine (`src/lib/erasure.ts`: deletes session rows, nulls the email, leaves an opaque `erased` tombstone so staff work keeps referential integrity). Removing staff access deletes the account, or erases it when a transcription assignment still points at it (`src/lib/admin.ts#revokeRole`). `/admin/roles` redirects to `/admin/users`.

**Uploads.** Admin-only. nginx `client_max_body_size 256m` on staff routes (a batch of PDFs); re-checked app-side per file, **affidavit PDFs ≤ 20 MB**. Type is validated by magic bytes against an allowlist (§13) before the bytes are persisted; extension and client MIME type are ignored.

**No role is ward-scoped.** `src/middleware.ts` admits curator and admin routes by role alone and transcriber writes by assignment ownership.

**Staff sign-in** is one shared password: `/login` takes an existing active staff account's email plus `MASTER_PASSWORD` (`src/lib/master-login.ts`; at least 16 characters, checked on every request). With it unset nobody can sign in. There is no OTP, email or WhatsApp sign-in, and no citizen accounts: the `role` enum is `transcriber | curator | admin`.

**Sessions** are signed cookies, `HttpOnly; Secure; SameSite=Lax`, with a sliding **1-hour idle timeout for every role** (`src/lib/session.ts`). The `/login` return target is validated as a same-origin relative path. One middleware enforces roles, rejects unsafe methods that fail an `Origin`/`Sec-Fetch-Site` same-origin check, and requires a synchronizer CSRF token on staff form routes (§13).

**Rate limiting is layered.** nginx `limit_req` per IP on `/api/*` with **per-endpoint zones and high bursts, sized for carrier-grade NAT** (much of Bengaluru's mobile traffic shares Jio/Airtel egress IPs), so per-IP limits are a coarse flood backstop; reCAPTCHA, receipt uniqueness, the flag allowances and daily budgets carry the real abuse weight. The k6 test (§12) asserts legitimate-shaped traffic sees no 429s at election-day volume.

**There is no rollback.** A wrong published value is corrected by publishing over it — by a curator, or through an accepted flag. Nothing can tell you what a field held yesterday.

## 8. SEO / AEO

- Complete HTML at first byte for all public content.
- **JSON-LD** per page type (`src/lib/seo.ts`): `Person` (candidates), `AdministrativeArea` (wards), `Event` (the election, on `/about-election`, when `election_date` is set), `Organization` (Oorvani, on `/about`), `BreadcrumbList`. Voter questions are consolidated on `/voter-faqs`, which emits no `FAQPage`.
- Per-language **sitemaps** with `lastmod` from publish timestamps, regenerated hourly by `jobs` (see the serving gap in §16); `robots.txt`; canonical URLs; `llms.txt`.
- `noindex` (`X-Robots-Tag`, `src/middleware.ts`) and sitemap exclusion: `/curator/*`, `/admin/*`, `/transcribe/*` and `/login`.
- **Open Graph tags on every page** in that page's language — distribution is WhatsApp forwarding.
- AEO: a concise factual summary at the top of ward/candidate/guide pages; question-shaped headings; facts in visible text.
- Candidate routes before data lands return **200 with the empty state**, so shared URLs accumulate authority. Withdrawn and rejected candidates stay **200 with a status banner**; only unknown slugs 404.

## 9. Bilingual content: three text layers

| Layer | Lives in | Kannada generated | Reviewed by |
|---|---|---|---|
| UI strings | `src/i18n/en.json` / `kn.json` | dev-time script | PR review |
| Editorial pages (guides, about, legal) | `content/pages/en/…`, `content/pages/kn/…` | dev-time script | PR review |
| Curator data (report cards, ward issues) | Postgres (`value_en` / `value_kn`) | at publish, runtime | nobody — citizen flags are the correction path |

No layer translates at request time; every render is from stored text.

**Dev-time script** (`npm run translate`): finds missing or stale Kannada files/keys (staleness = hash of the English source stored beside the Kannada), drafts them via the Anthropic API, writes ordinary committed files. **Regeneration is unconditional:** hand-edits to generated output are overwritten on the next English change. Corrections live in **translation hints** — instructions in the English file's frontmatter (or a `__hints` entry beside a UI key) naming the sentence or word and how to render it; hints are included on every regeneration.

**Glossary** (`src/i18n/glossary.json`): canonical Kannada for recurring terms (party and corporation names, "corporator", "ward", "affidavit"), used by both the dev-time script and the runtime path.

**Staleness check** (`npm run translate -- --check`): exits non-zero when a Kannada file or key is missing or its stored hash no longer matches. No API calls. CI runs it as part of the merge gate (§14.4) via `scripts/ci/translate-gate.ts`, which tolerates one accepted stale file, `content/pages/kn/privacy.md` (regenerate it once an Anthropic key is available, then remove the exception).

**Runtime path (curator data), per field** (`src/lib/translate-runtime.ts`):

1. A publish writes the authored value, `authored_lang` and `translation_status = pending`. The authored-language page is live immediately.
2. After commit, the app calls Anthropic (5 s timeout) for the changed fields only, with field name, candidate/ward and the glossary. Success writes the other language and `translation_status = done`.
3. On failure the field stays `pending` (shown in the authored language with an untranslated indicator) and `jobs/translate-retry.ts` retries every 5 minutes.
4. A curator editing the Kannada value directly sets `translation_status = manual`, excluding it from MT until the source value changes again.

Candidate names and parties render from the report-card `full_name` and `party` rows in both languages. Migration `0014` moved the legacy Kannada name/party columns into those rows, and migration `0017` dropped the columns. The candidate editor validates all edits, then one transaction writes changed values only; unchanged fields keep their review metadata.

Never machine-translated: official bilingual data (ward names) and UI strings.

## 10. Jobs and ops

**Cron** (`deploy/crontab`, run by `supercronic` in `jobs`):

| Schedule | Job |
|---|---|
| every 5 min | `jobs/translate-retry.ts` — re-drives `pending` translations |
| hourly | `jobs/regen-sitemaps.ts` |
| 06:15 | `jobs/flag-cleanup.ts` — expires flag-abuse metadata |

- **Logs:** structured JSON to stdout (pino, `src/lib/logger.ts`), Compose `json-file` driver capped at 10 MB × 5 files per service. `/healthz` backs the nginx container healthcheck.
- **Monitoring: none external.** No uptime check, no SSL-expiry alert, no disk alert, no error reporting, and the geocode/EPIC/vote budgets only refuse — they alarm nobody. A silently failed certbot renewal surfaces as an outage on expiry day; the daily `nginx -s reload` (§14.5) picks up *successful* renewals only. Nothing watches disk; exhaustion taking Postgres down mid-spike is a live risk.
- **Disk.** One 193 GB disk carries Postgres (including affidavit PDFs, §6), the nginx cache, rotated logs and locally built images. Pruning old images is manual and careful: `:previous` is the only rollback path (§14.3), so never `docker image prune` blindly.

## 11. Error handling

- Address lookup: `ambiguous` ("be more specific") is the one failure the citizen can act on. Budget exhaustion, a Google failure or a resolved ward missing from the DB return `unavailable`, phrased as our outage. A point outside every GBA polygon returns `out_of_coverage`. **There is no fallback for typed addresses.** Device-location mode calls nothing, so it still answers during a geocoder outage; its own failures (permission refused, no fix) point back to the address field.
- Booth lookup returns `booth`, `not_found` (EPIC not on the roll, or not recognized upstream), or `unavailable` (`timeout`, `failed`, `malformed`, `budget`). If the ward cannot be mapped, the booth still renders without it.
- Unknown ward or candidate returns a real 404; candidate routes before data and withdrawn/rejected candidates return 200 (§8).
- Translation failure never blocks publish (§9). Extraction failure never publishes *not declared* (§6).

## 12. Testing

- Vitest unit tests (`tests/unit/`) and route tests (`tests/routes/`).
- Playwright smoke suite (`tests/e2e/`): `lookup.spec.ts` (ward lookup → ward page), `language.spec.ts` (EN → `/kn/` equivalence and hreflang), `flag.spec.ts` (anonymous flag → curator accept → correction live), `vote.spec.ts` (anonymous inline vote; receipt survives reload), `footer.spec.ts`.
- `tests/load/k6-election-day.js` proves the micro-cache holds election-day read volume on the real VM and that legitimate-shaped traffic through the CGNAT-sized limits (§7) sees no 429s.
- `tests/routes/cache-invariant.test.ts` asserts public GETs set no cookies and carry no session-dependent bytes — the guard on §5.
- `tests/unit/media.test.ts` rejects over-size and off-allowlist uploads.
- **The CI gate** (`.github/actions/gate/action.yml`, run by `ci.yml` on every PR and by `deploy.yml` before deploying an untested tree): typecheck, translation staleness (§9), build, Vitest against a Postgres service, Playwright smoke. The required status check is `test` (§14.4).

## 13. Security

Per-mechanism details live where they apply (§5 cache, §7 sessions and abuse controls, §10 jobs and ops, §12 tests); this section carries the cross-cutting rules and the accepted limitations.

- **CSRF:** `SameSite=Lax` cookies; middleware `Origin`/`Sec-Fetch-Site` check on all unsafe methods, failing closed when both headers are absent; synchronizer tokens on staff forms (`src/lib/csrf.ts`). Forged curator publishes are the worst outcome this design can produce.
- **Cost amplification:** `geocode_cache` stores normalized address → ward id only, never Google's coordinates or content. Daily budgets cap geocoding, EPIC lookups and anonymous votes; exhausting them degrades availability, not cost. Anthropic is triggered only by staff publishes and affidavit extraction, never public traffic. PDFs are served behind the nginx cache.
- **Headers:** nginx sets HSTS, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` (`deploy/nginx/snippets/security-headers.conf`). **The CSP is set by the app** per request (`src/lib/csp.ts`, wired in `src/middleware.ts`), because its script nonce must match the nonce baked into cached HTML; nginx passes it through untouched. `script-src` is `'self'` + the request nonce + GA and Maps hosts — no `unsafe-inline` on scripts; the nonce'd inline scripts are JSON-LD and the GA config. `frame-ancestors 'none'` everywhere except `/media/{id}/{hash}` (`'self'`). Ward detail and candidate pages also allow the reCAPTCHA hosts (`www.google.com`, `www.gstatic.com`). `frame-src 'self'` on the transcriber reading screen, the three curator screens that show an affidavit beside a form (`/curator/queue/{id}`, `/curator/candidate/{id}`, `/curator/matching/{id}`), and candidate pages (alongside reCAPTCHA). So those pages, and no other site, can frame a stored PDF.
- **Content rules:** flag text renders as text; every curator-supplied URL is validated to `http(s)` at write time; JSON-LD is serialized with `<` escaped; MT output is stored and rendered as plain text through normal escaping. Submitted flag links are never fetched.
- **Logs carry IDs, not identities:** application logs never contain lookup addresses, EPIC numbers, voter names, flag tokens, raw IPs or report text — opaque ids and result kinds only. nginx access logs do contain client IPs.
- **Processors.** Google (Geocoding, Maps JS, Places, reCAPTCHA, Analytics) and Anthropic process data outside India; the BBMP electoral API receives EPIC numbers. Flows are enumerated in `/privacy`. Affidavits are sworn public documents, not citizen personal data.
- **Breach response:** the DPDP Act requires notifying the Data Protection Board and affected data principals of a personal data breach. The runbook needs a named owner and procedure (§16).
- **Uploaded media:** magic-byte check at ingest: affidavit PDFs only (no images, **no SVG**); `/media` serves only stored PDFs. Served with `Content-Type` from the validated stored type plus `nosniff`; PDFs inline with `Content-Type: application/pdf`. Size caps: §7.
- **Secrets:** the source of truth is the GitHub `production` environment (limited to `main`). Each deploy renders `/etc/bengaluru-votes/.env.production` (mode 600, outside the tree) from it per `deploy/env.production.manifest`, so values edited on the box are overwritten. Holds vendor keys, `SESSION_SECRET`, `FLAGS_ABUSE_SECRET`, Postgres credentials and the CI root SSH key. Staff sign-in is being reworked to per-staff passwords in a separate change.
- **Accepted limitations:**
  - **No change history at all — the largest accepted limitation.** Nothing records who published a value, when, or what it replaced. Four decisions rest on the remaining nets alone: **city-wide unscoped curators**, **one transcriber per affidavit**, **publish-immediately with no approval gate**, and **machine-translated Kannada published unreviewed**. What remains is forward-only: a citizen flags a value and a curator resolves it. **An incorrect value on a candidate's criminal record has no recorded author and cannot be put back**, and the platform cannot answer "who changed this".
  - **What curator trust does not protect against.** A wrong fix or ward move overwrites the published value and is public within 60 seconds; the confirmation tick and refusal of unchanged saves are the only brakes. A curator can move any candidate to any ward and create candidates from waiting affidavits; a moved candidate keeps the old ward number in its slug. Attaching an affidavit to the wrong same-name candidate publishes its values over that candidate's, and nothing restores them. Curators and admins share one matching list: the row lock in `confirmMatch` stops a double publish, not duplicated effort. Vetting is the only control on a curator login.
  - **Anonymous reports can be coordinated.** Browser receipts and network hashes are not identities; shared networks are deliberately allowed many reporters. The controls bound volume and curator workload, not truth — curators decide, and counts never rank or publish anything.
  - **Prompt injection** into MT and extraction (affidavit PDFs and curator text are adversarial inputs) is mitigated by escaping, a fixed extraction schema, visible provenance labels and the flag correction path. No further machinery.
  - **Sessions:** 1-hour sliding idle timeout for every role; no session revocation on role change and no login notifications for staff — the short timeout carries the weight.
  - **A merge to `main` is a production deploy.** CI deploys as `root` over key-only SSH with the host key pinned (§14.4); the ruleset requires a PR and the `test` check but zero approvals, and repository admins can bypass it. So a malicious or mistaken change that passes the tests reaches production, and anyone holding the `production` environment's SSH key holds the box. A `docker`-group deploy user would be root-equivalent anyway, so there is no pretended privilege boundary; the controls are who can merge and key custody. Fork PRs get no secrets (`pull_request`, never `pull_request_target`); actions are pinned by SHA.

## 14. Deployment (Hostinger VPS)

### 14.1 Region & compute

One Hostinger VPS, **4 vCPU / 16 GB / 193 GB**, in **Mumbai**, the closest India region on offer. The k6 test (§12) validates nginx cache behaviour and rate-limit sizing on this box; if it falls short, the remedy is a Hostinger plan upgrade.

**No reserved IP.** DNS points straight at the VPS address (`76.13.244.198`), so replacing the box needs a DNS change and propagation wait; keep TTLs at 300 during any cutover. The box has a global IPv6 address (`2a02:4780:12:4759::1`); `AAAA` records are published only once public reachability is confirmed, because Let's Encrypt prefers `AAAA` and fails issuance if it cannot reach it.

### 14.2 One environment

**Production is the only environment.** One Compose project (`deploy/compose.production.yml`) runs the services in §3; nginx terminates TLS for `bengaluruvotes.opencity.in` on the `front` network and everything else sits on `back_prod`. Any other hostname falls to nginx's default server and is rejected.

Consequences:

- **Nothing exercises a migration before production does.** Rehearse a risky migration against the local stack first.
- **The local Compose stack** (`deploy/compose.local.yml`) is the only preview of unreleased work.

### 14.3 Images

**There is no registry.** The image is built **on the box** from a git checkout by the repo `Dockerfile` and tagged locally (`bengaluru-votes:${IMAGE_TAG:-latest}`); `jobs`, `extract-worker` and `static-init` reuse that tag with `pull_policy: never`. Nothing is pushed or pulled.

Costs: builds compete with live traffic for CPU; two builds of one commit are not guaranteed byte-identical; nothing outside the box can pull the image.

Before each deploy the running image is tagged `:previous`, so the last-known-good survives the new build overwriting `:latest`. Docker's image cache is the only store, so `docker image prune` is not safe to run blindly.

**One checkout, detached on the release tag** — `git log -1` there answers "what is running":

```
/root/src/bengaluru-votes-production    detached on an annotated tag vYYYY.MM.DD
/etc/bengaluru-votes/.env.production    mode 600, outside the tree
```

The Compose project name is **pinned in the compose file** (`bengaluru-votes-production`). Never change it on a live box: a new project name means a new, empty `pg_data_prod` volume, which looks like the database vanished.

**Every release is a rebuild.** `astro.config.mjs` resolves `site` and `security.allowedDomains` at *build* time; an image built for the wrong origin serves every GET with 200 and 403s every POST.

### 14.4 Release flow

Deploys are **automatic from `main`**: every push to `main` (a PR merge or a direct commit) deploys production.

Why: changes come from cloud coding agents and outside contributors, so a change must go from pull request to production with no laptop in the loop, and production config lives in GitHub rather than only on the box.

- **Merging.** Changes reach `main` by pull request (ruleset `.github/rulesets/main.json`: PR required, 0 approvals, required check `test`; repository admins can bypass). `.github/workflows/ci.yml` runs the gate (§12) with no secrets and read-only permissions.
- **Deploying** (`.github/workflows/deploy.yml`). If the pushed tree equals one a same-repo PR run already passed (`scripts/ci/tested-tree.ts`), tests are skipped; otherwise the gate runs first. Then: tag `vYYYY.MM.DD` (`.2`, `.3`… for later same-day releases, Asia/Kolkata date; `scripts/ci/tag.ts`) → render and install `/etc/bengaluru-votes/.env.production` from the GitHub `production` environment per `deploy/env.production.manifest` (`scripts/ci/env-render.ts`, `deploy/install-env.sh`) → `deploy/deploy.sh production <tag>`. A missing required key fails the run before the box is touched. A push that is no longer `main`'s head is skipped.
- **`deploy/deploy.sh`** runs over SSH: preflight (tree exists and is clean, env file present) → tag the current image `:previous` → check out the tag → build with production's `SITE_ORIGIN` → migrate (§14.7) → `up -d` → re-run `static-init` → test and reload nginx config → verify, **including a real POST** (a 403 fails the deploy).
- **Failure handling.** `deploy.sh` exits 1 for a failure before the restart (old version still serving) and 3 after it; CI restores the previous env file on any failure and runs `--rollback` on exit 3. GitHub emails whoever triggered a failed run; there is no other alerting.
- **Manual actions:** Actions → deploy → Run workflow: `redeploy-current`, `deploy-tag` (must be in `main`'s history), `rollback`. `deploy/deploy.sh production <tag>` and `--rollback` still work by hand, but the next CI deploy reinstalls the env file from GitHub.
- **New config:** add the key to the GitHub `production` environment and to `deploy/env.production.manifest` in the same PR.
- **Production is a tag**, checked out detached; `git log -1` on the box answers "what is running". Rollback is a `:previous` retag and restart, never a schema step, because migrations are backward-compatible (§14.7).
- **Access:** SSH as `root`, key-only, password authentication disabled (§13). CI uses its own dedicated key pair (revocable without touching personal keys), with the host key pinned in the workflow. It is not restricted to a forced command, because `deploy.sh` issues many remote commands.
- **Gate time:** the `test` job measured 2m43s on GitHub. To trim it, drop the Playwright steps from `.github/actions/gate/action.yml` first.

### 14.5 Network & TLS

Inbound 22, 80 and 443 only, enforced by **`ufw` on the box** (`deploy/runbook.md`). TLS is Let's Encrypt via the **certbot container**: HTTP-01 for `bengaluruvotes.opencity.in` (nginx serves `/.well-known/acme-challenge/` from the shared webroot volume), certificates on a volume shared with nginx, renewal attempted every 12 hours. nginx runs a **daily `nginx -s reload`** loop, so renewed certificates take effect without giving certbot a docker-socket mount. No SSL-expiry alert exists (§10).

### 14.6 Provisioning runbook

No Terraform. Provisioning is `deploy/runbook.md`:

1. Point DNS at the VPS IPv4 (`A` only; `AAAA` after IPv6 is confirmed, §14.1).
2. Harden the host: `ufw` allowing 22/80/443, SSH key-only.
3. Install Docker Engine and the Compose plugin.
4. Clone the repo (§14.3); write `.env.production` (mode 600, outside the checkout).
5. Bootstrap self-signed certs so nginx can start; bring the stack up; issue real certs.
6. Run migrations (`docker compose run --rm app npm run migrate`) — `up -d` does not migrate.
7. Seed wards and the first admin (`npm run seed:admin -- <address>`). Every later role grant is an admin action at `/admin/users`.
8. Verify the hostname, including a real POST.

### 14.7 Database migrations

- **Drizzle Kit generates SQL migration files** (`drizzle/`), committed and reviewed like code.
- `deploy/deploy.sh` runs `docker compose run --rm app npm run migrate` with the just-built image, between build and restart. A failed migration aborts the deploy before any container restarts; the running version continues against the unchanged schema.
- **Migrations are forward-only and backward-compatible** — expand, backfill, contract in a later release. The previous image must run against the new schema, so rollback (§14.4) is never a schema downgrade.

### 14.8 Running cost

The VPS is already paid for. Monitoring costs nothing because none exists (§10). Metered spend sits on top and has no total on paper: geocoding (capped by budget), Maps JS loads and Places Autocomplete (§16), and Anthropic.

## 15. Dormant code slated for removal

Citizen registration, citizen accounts, OTP sign-in, email/WhatsApp messaging and Sentry were removed in full (code, jobs, tables and columns: migration `0016`); further dormant features and tables were removed by migration `0017`. The code below is still in the repo and must not be treated as a feature. Each item is a removal candidate.

| Leftover | Paths | Why it is dormant, and the live risk |
|---|---|---|
| Orphan pages | `src/features/pages/HowToVote.astro`, `VoterId.astro`, `FindBooth.astro` | Not routed; `/voter-faqs` and the home-page booth card replace them |

## 16. External dependencies & known gaps

| Dependency | Used for | State / gap |
|---|---|---|
| Hostinger VPS (Mumbai) | Everything (§14) | Single box, no reserved IP |
| Google Geocoding API | Address → ward (§7) | Server key; daily budget in app. GCP-side budget/quota alerts are not confirmed configured |
| Google Maps JS API + Places API (New) | Ward map, address autocomplete | `GOOGLE_MAPS_BROWSER_KEY` (referrer-restricted), `GOOGLE_MAPS_MAP_ID` (style lives in the Cloud console, outside code review). Per-load billing on the highest-traffic page was accepted deliberately for a lazy-on-scroll map; mitigations are the `MAPS_ENABLED` kill switch (sheds map and autocomplete without a rebuild), GCP quota caps and budget alerts |
| BBMP electoral API (`electoralapi.bbmpgov.in`) | Booth lookup by EPIC | No key, no contract, incomplete TLS chain; may change or vanish without notice. Daily cap `EPIC_DAILY_BUDGET` |
| Anthropic API | Kannada MT, affidavit extraction | `ANTHROPIC_API_KEY`; without it, MT stays `pending` and `extract-worker` exits |
| reCAPTCHA v3 | Issue votes, candidate reports | Fails closed in production without keys |
| Google Analytics 4 | Visitor measurement | `GA_MEASUREMENT_ID`; public indexable pages only; disclosed in `/privacy` |
| Let's Encrypt | TLS | Renewal failure has no alert |
| GitHub | Source the box builds from | Free; the access list is the trust boundary |
| **Monitoring** | Uptime, SSL expiry, disk, budget alarms | **None in place** (§10) |
| **Sitemap serving** | §8 | `jobs` writes sitemaps to its own container's `/app/public` (`src/lib/seo/sitemaps.ts`); neither `app` nor nginx reads that path, and no route serves `/sitemap.xml`, so production likely serves no sitemap. Unverified against the live site |
| **Breach-response runbook** | DPDP obligation (§13) | No named owner or written procedure |

## Open questions

- Which external monitor for uptime, SSL expiry and disk?
- Retention period for staff accounts and citizen report text, pending legal confirmation.
