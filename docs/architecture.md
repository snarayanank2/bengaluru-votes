# Production Architecture

This document records the production architecture for the platform described in `docs/overview.md` and planned in `docs/milestones.md`. It answers: what runs where, what is cached, what is dynamic, and how the site stays fast, bilingual, indexable, and secure on a single VM with no CDN. Decided 2026-07-17; transcription reworked 2026-08-15; affidavit storage moved to Google Cloud Storage 2026-08-15 (§6).

---

## 1. Context & constraints

- **Hosting shape is decided:** a single VM running Docker Compose (`docs/project-dependencies.md` §6.1) — a Hostinger VPS in Mumbai; the full deployment design is §14. No CDN at launch; one may be added later.
- **Traffic shape:** overwhelmingly anonymous, read-only, spiking near election day. Content changes only when a curator publishes — not per request. Anonymous reads must stay fast with no login wall.
- **Team:** TypeScript/Node.
- **SEO/AEO is a requirement:** ward, candidate, and guide pages must be indexable by search engines and quotable by answer engines, in both English and Kannada.
- **Decided vendors** (dependency register §3, §6): Twilio/SendGrid for messaging, Google Geocoding server-side, Google Maps JavaScript API for ward-boundary rendering (migrated from MapLibre 2026-08-13; dependency register §6.4, closed), **Google Cloud Storage for affidavit PDFs** (decided 2026-08-15; §6, dependency register §6.19), Anthropic API for Kannada machine translation and affidavit field extraction, Google Analytics for visitor/event measurement (client-side snippet on public pages; static markup, so it does not break the one-cached-variant-per-URL invariant in §5). Places Autocomplete (`google.maps.places.PlaceAutocompleteElement`, `src/islands/WardLookup.ts`) on the ward-lookup input **shipped 2026-08-14** (dependency register §6.4): the legacy `google.maps.places.Autocomplete` widget has been unavailable to new customers since 2025-03-01 and legacy Places services are unavailable in new Cloud projects, so `PlaceAutocompleteElement` was the only viable option — it runs on the **Places API (New)** that dependency register §6.4 had already provisioned against this eventuality.

## 2. Decision summary

| Decision | Choice |
|---|---|
| Application | One **Astro SSR monolith** (Node adapter, TypeScript): public pages, API endpoints, curator/admin screens |
| Database | **Postgres**, accessed via Drizzle |
| Edge | **nginx**: TLS, static files, per-IP rate limiting, **micro-cache** for anonymous page GETs |
| Jobs | A **cron container** sharing the app codebase: send calendar, translation retries, backups |
| Language URLs | English at root, **Kannada under `/kn/`**, hreflang-linked; the toggle navigates between them |
| Spike strategy | nginx micro-cache (~60 s TTL on pages) — no purge machinery; CDN slots in front later unchanged |
| Geo | Ward polygons as static GeoJSON; the Google Maps JS island fetches one ward's Feature from `GET /ward/<id>/boundary.json` (`src/pages/ward/[id]/boundary.json.ts`, `src/lib/geo.ts`'s `wardBoundaryFeature()`) — deliberately not under `/api/`, so it lands in nginx's cached, cookie-stripped public route rather than the uncached, rate-limited `/api/` one — plus in-memory point-in-polygon (Turf.js) for the address lookup; **no PostGIS** |
| Client JS | Zero by default; islands only for modals, maps, and lookup forms |
| Deployment | **Hostinger VPS (Mumbai)**; staging + production on one box; images built on the box from a checkout; deploys run by hand (§14) |
| Migrations | **Drizzle SQL migrations**, forward-only and backward-compatible; run as an explicit deploy step before restart (§14.7) |
| Media | **Two stores, by size and volume.** Candidate photos stay **bytea in Postgres**, served at immutable content-hashed URLs. **Affidavit PDFs go to Google Cloud Storage** (`asia-south1`, Mumbai), served at immutable content-hashed object URLs — decided 2026-08-15, because ~4,000 PDFs arriving in one nomination-window burst would otherwise sit on a 193 GB disk and inflate every nightly dump thereafter. The cost is that affidavits leave the `pg_dump` umbrella and need their own durability story (§6, §7, §10) |
| Monitoring | **Unresolved** (uptime/SSL-expiry checks lost with DigitalOcean, no replacement chosen) + server-side Sentry + email budget alarms — external and minimal, nothing new on the VM (§10) |

Alternatives considered: a Next.js monolith with ISR (heavier runtime, React hydration on every page, more framework than 19 mostly-read routes need) and a fully static build plus separate API service (spike-proof reads, but "publish immediately" becomes a rebuild pipeline and one deployable becomes two). Both were rejected in favour of the lighter shape above.

## 3. System overview

Four long-running Compose services per environment:

| Service | Role |
|---|---|
| `nginx` | TLS termination; serves static assets (built JS/CSS, ward GeoJSON, images, posters); micro-cache for anonymous HTML; `limit_req` rate limiting; compression; security headers (§13). **One shared container**, owned by the production stack (§14.2) |
| `app` | Astro SSR (Node). All routes: public pages, `/api/*`, `/account/*`, `/curator/*`, `/admin/*` |
| `postgres` | Single database |
| `jobs` | Cron-driven Node scripts: campaign sends, translation retries, sitemap regeneration, nightly `pg_dump` shipped off-box |

Plus two production-only helpers that are not steady-state services: a **`certbot`** container for Let's Encrypt issuance and renewal (§14.5), and a **`static-init`** one-shot that populates the nginx static volume — it does not re-run on `up -d` once it has succeeded, which is why `deploy/deploy.sh` re-runs it unconditionally on every production deploy (§14.4).

No Redis, no queue, no separate API service. Deploys build the image on the VM from a git checkout and restart (§14).

The one thing outside the box is **Google Cloud Storage**, holding affidavit PDFs (§6). Nothing else the platform serves lives off the VM.

## 4. Routing & rendering

- Public pages are server-rendered to complete HTML with **zero client JavaScript by default**. Hydrated islands only for: the Register/Login, Flag, and Cast-vote modals; the Google Maps ward-boundary map (`src/islands/WardMap.ts`, rendered only when `mapsConfig().enabled` — `src/lib/maps-config.ts`); the address lookup (with Places Autocomplete); the booth lookup.
- **Language:** every public path exists twice — `/ward/57` (EN) and `/kn/ward/57` (KN) — via Astro i18n routing. The app-bar toggle links to the same page in the other language. Every page emits `hreflang` alternates and `x-default`. A cookie remembers the last choice so `/` can offer Kannada on entry — read **client-side** by a small script, like the `?src` writer (§5), because nginx strips cookies on public routes and the cached HTML is identical for everyone; the offer is a client-rendered banner, never a server-side variant. A registered user's saved preference governs notification language only.
- Curator, admin, and account screens are server-rendered forms with standard POSTs in the same app — no SPA.
- Modals are progressive enhancements over real routes, so the `/login` no-JS fallback comes free.

## 5. Caching & the election-day spike

nginx `proxy_cache` on anonymous-shaped GET HTML:

- Public pages: **~60 s TTL**. Issue-vote results and `/data`: ~5 min. `/api/*`, `/account/*`, `/curator/*`, `/admin/*`: `no-store`, never cached.
- **Invariant: public page HTML never varies by session.** Logged-in users receive the same cached anonymous markup; the three personalized elements (Sign-in vs Account control, register-for-updates slot, already-voted state) are swapped client-side from one `GET /api/me` call. The invariant is enforced, not assumed: **nginx strips the `Cookie` header** before proxying public-page routes, so the app cannot see a session on a cached path, and a route test asserts no `Set-Cookie` on public GETs (§12). Each URL has exactly one cached variant per language.
- **The cache key ignores the query string entirely** on public pages — unknown params can neither fragment the cache nor cache-bust it into a DoS on the origin. `?src={partner}` attribution still works: a small inline script reads `location.search` client-side and stores the slug in a cookie, which the registration endpoint reads.
- Worst-case origin load is every public URL rendered once per TTL — about 4,000 renders/minute at the absolute ceiling (369 wards × ~5 pages × 2 languages), well within one Node process. The spike lands on nginx, which serves cached responses at static-file speed.
- The 60 s window satisfies "curator edits go live immediately"; curators previewing edits use uncached curator routes.
- **Stale-while-restart:** `proxy_cache_use_stale error timeout updating` plus `proxy_cache_background_update` — cached public pages keep serving through the seconds an app restart takes (deploys, §14.4; a pre-election resize, §14.1) and through brief origin failures. Only uncached paths (`/api/*`, account/curator/admin) blip during a restart.
- **Uploaded media** (candidate photos, affidavit PDFs) is served at immutable content-hashed URLs (`/media/{id}/{hash}`, §7) with a long nginx cache TTL. An edit produces a new URL, so long-lived media caching coexists with the 60 s page TTL and the query-string rule above.
- **The Host header cannot poison the cache.** Every server-generated absolute URL — canonicals, `hreflang` alternates, `og:url`, JSON-LD `@id`, sitemap entries — derives from the fixed configured origin (Astro `site`), never from the request's `Host` or `X-Forwarded-Host`. nginx proxies only its named server blocks and passes a pinned `Host`; a default server rejects unmatched hosts. With output Host-independent, the path-plus-language cache key stays safe.
- A CDN added later sits in front of nginx with the same cache headers; the one required change is trust: nginx then takes client IPs for rate limiting from `X-Forwarded-For` via `real_ip`, restricted to the CDN's published ranges, so per-IP limits stay unspoofable.

## 6. Data model (sketch)

`wards` (id, name_en, name_kn, corporation, boundary ref) · `ward_candidate_questions` (ward, position 1–5, question_en, question_kn; static seeded editorial content) · `candidates` (slug, ward, party, photo → media, lifecycle status `filed|contesting|rejected|withdrawn`) · `candidate_fields` (candidate, field key, value_en, value_kn, authored_lang, translation_status, source_url, source_type `official|curator`, **check state `ai_extracted|checked`, plus `checked_by`, `checked_at` and the extraction `confidence` that drives queue priority** — the published value is whatever this row holds, and the state is a label on it, never a gate in front of it) · `candidate_affidavits` (candidate, **GCS object key + bucket + sha256 + size**, origin EC URL if fetched, extraction status; the stored copy is the public source link for affidavit fields) · `media` (bytes as bytea, validated content type, sha256, size — **candidate photos only**; affidavit PDFs moved to Google Cloud Storage 2026-08-15, see below) · `ward_issues` + per-candidate stances (deleting an issue cascades its vote-set entries; renaming keeps them) · `booths` (name_en, name_kn, address, location, ward) · `issue_votes` (user, ward, up to 3 issues; one active set per user, retired on home-ward change) · `users` (email and phone — each globally unique, either logs in; home ward, language, role, `src` attribution, consent record: timestamp + wording version + the optional future-civic-tools opt-in) · `otp_codes`, `sessions` · `suppressions` (contact, channel, reason `bounce|complaint|stop`; written by the §7 webhooks, honoured before every send) · `flags` (ward, dedupe key → count; one city-wide queue, worked by any curator) · `partners` · `eoi_submissions` · `ward_readiness` (completeness snapshot — counting only filed/contesting candidates; a coverage figure for `/data`, not a gate: the sign-off that used to hold sends back was dropped 2026-08-15).

**There is no `audit_log`. Removed 2026-08-15**, along with the `/admin/audit` viewer and the per-entry restore action. The platform keeps no history of who changed what: a field row holds its current value and nothing behind it. §13 records what that costs.

**What survives on the field row, because one thing still needs it.** `candidate_fields` carries `checked_by` and `checked_at` (who last checked the value), plus a **`corrected_after_check` marker** set when a curator or an accepted flag changes a value that a transcriber had already marked checked. That single boolean is what keeps the transcriber accuracy view (§7, `docs/milestones.md` §9) computable without a change log — it answers "was this reading later overturned" without recording what it was overturned to. It is a counter, not a history.

**Transcription (`docs/milestones.md` §9–§10, milestones M7 and M8):** `transcription_assignments` (affidavit, transcriber, state `open|submitted|abandoned`, drawn_at, expires_at — an assignment is *held*, not owned; expiry returns the affidavit to the queue so a half-read one is never stranded). A submitted reading writes straight through to `candidate_fields` and publishes; it is not staged anywhere first. The `confirmed_ai` flag — whether the transcriber accepted the pre-filled extraction or typed something else — lives on the field row, and is what makes the rubber-stamp risk measurable rather than merely acknowledged.

**Consensus was removed on 2026-08-15.** One transcriber reads each affidavit and their save goes live immediately. `transcription_readings` and `field_disputes` are therefore not built, and `candidate_fields.verification_state` collapses from four values to two.

**Two invariants in this area, both enforced in the database rather than in application code:**

- **The queue draw is atomic, and prioritized in the same statement.** Selecting the next affidavit and creating its assignment happen in one statement (`UPDATE … RETURNING`), ordering by extraction outcome — candidates with missing values first, then low-confidence, then the rest, randomized within each tier. Two transcribers hitting *Start* in the same second cannot be handed the same document, and the priority order cannot drift between callers because no caller computes it.
- **A field's check state is computed on write, not typed.** `checked_by` and `checked_at` are set by the same transaction that publishes the value. Nothing writes "checked by a person" independently of a person having checked it.

There is deliberately **no unique index on (affidavit, transcriber)**. It existed to stop one person satisfying the two-reading rule alone; with one reading there is nothing for it to protect, and it would only block a transcriber legitimately picking up an expired assignment they had started earlier.

**Affidavit PDFs live in Google Cloud Storage, not Postgres** — decided 2026-08-15, and a deliberate exception to the single-store rule the rest of `media` follows (`docs/milestones.md` §11, M9). The driver is the shape of the arrival: roughly **4,000 affidavits land in one burst during the nomination window**, against a 20 MB per-file cap, on a box with a 193 GB disk shared between two Postgres instances, the nginx cache, logs and locally built images (§10). Plausibly several GB, and as `bytea` every nightly dump afterwards would carry the whole set.

What the move buys and what it costs, both stated:

- **Buys:** the dump stays small and fast, disk headroom stops being a nomination-week risk, and the PDFs are served without passing through the Node process at all.
- **Costs:** affidavits leave the `pg_dump` umbrella, so they need their own durability story rather than inheriting one. That is **object versioning plus a lifecycle policy on the bucket**, not a second restic repository — GCS durability is the mechanism, and the bucket is the backup. Restoring a database therefore no longer restores the affidavits with it: `candidate_affidavits` rows hold object keys, and a restore is only consistent if the bucket still holds those objects. Never lifecycle-delete an object a live row points at.
- **Region is not a free choice.** The bucket is **`asia-south1` (Mumbai)** — the same India-residency requirement §13 puts on the off-box database backup, for the same DPDP reason, and the same region as the VM.
- **Access model:** objects are written by the app with a service-account credential, keyed by content hash, and **read publicly** — an affidavit is the public source behind a published claim, so a signed-URL scheme would buy secrecy the data does not need while breaking the "open the affidavit behind any value" promise (§8's shareable-URL property). Uniform bucket-level access, public read, no object ACLs.
- **Validation does not move.** Magic-byte and size checks (§13) run app-side *before* the upload, exactly as they did for `bytea`. Nothing reaches the bucket unvalidated.

Two things still to check against a real sample before the burst: per-object upload throughput during ingestion, and the bucket's monthly cost at full volume (dependency register §6.19 — it is a new metered service, and §6.11's total was written without it).

Sources are per-field. Ward boundaries are static GeoJSON — committed at **`data/gba.geojson`** (369 wards: polygons plus ward/corporation/zone/assembly/RO metadata, EN + KN names) — served by nginx and loaded into app memory at boot for point-in-polygon lookups; `seed-wards` maps its feature properties into `wards`. The same command loads five bilingual questions per ward from **`data/ward-candidate-questions.json`** into `ward_candidate_questions`; that committed seed is derived from OpenCity's `ward_facts_questions.geojson`, contains only `question_1`–`question_5`, and maps the source to the GBA wards by unique normalized English name because the source's numeric ward ids repeat across corporations. The pincode → ward shortlist table that used to back a fallback lookup was removed 2026-08-14 (§11).

## 7. API surface & auth

Public endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/ward-lookup` | Two input modes. `{lat, lng}` (the "use my current location" control, added 2026-08-14) → point-in-polygon → ward: no external call, no budget spend, no cache row, and the position is discarded after the answer. `{address}` → server-side Google geocode → point-in-polygon → ward. Returns a ward, never coordinates — `src/lib/geocode.ts` keeps this rule on privacy grounds now that dependency register §6.4 is closed (Google Maps content is no longer displayed alongside a non-Google map, so the old Maps-ToS reason no longer applies; the no-coordinates rule stayed anyway, 2026-08-14) — or an explicit out-of-coverage answer when the geocoded point lands outside every GBA polygon. Normalized-address → ward-ID results are cached (our derived conclusion, no Google content stored); a global daily geocode budget stops calls when exhausted, which takes the *address* mode down rather than degrading it — pincode lookup was removed 2026-08-14 (§11), and the coordinate mode is unaffected because it never calls Google |
| `POST /api/booth-lookup` | Same shape, booth data |
| `POST /api/otp/request`, `POST /api/otp/verify` | All roles. Email OTP (SendGrid); WhatsApp OTP for citizens when templates approve — staff are email-only. Hashed 6-digit code, 10-minute expiry, 5 verify attempts per code (then invalidated); per-destination request cooldowns and a global daily send budget with an alarm (§13) |
| `GET /api/me` | Session state for client-side personalization |
| `POST /api/flags` | Gated write; dedupe |
| `PUT /api/issue-votes` | Home-ward check; one active vote-set |
| `POST /api/eoi` | The one anonymous write; protected by **reCAPTCHA v3** (server-verified token + score; the script loads only on `/partner-with-us` — §13), disclosed in `/privacy` alongside GA |
| `POST /api/webhooks/sendgrid` | SendGrid event webhook: bounces and spam complaints write `suppressions` (§6). Signed-event verification |
| `POST /api/webhooks/twilio` | Twilio callbacks: WhatsApp delivery status; an inbound STOP suppresses the channel permanently. `X-Twilio-Signature`-verified |
| `GET /media/{id}/{hash}` | **Candidate photos**, served from Postgres at an immutable content-hashed URL, long-TTL cached (§5); `Content-Type` comes from the validated stored type, never from the upload (§13). **Affidavit PDFs are not served here** — they are linked directly at their Google Cloud Storage object URL (§6), so the PDF never passes through the app |

There is no pincode endpoint or lookup table any more (removed 2026-08-14, §6, §11): `POST /api/ward-lookup` above is the entire public surface for finding a ward, in either of its two input modes.

Webhook endpoints are `no-store`, carry no session, and reject anything that fails signature verification. They get their **own generous `limit_req` zone**, deliberately not the general `/api/*` one: a campaign to 25,000 recipients returns bounce and delivery events from a handful of vendor IPs within minutes, and throttling that burst would silently drop suppression and STOP events. As a safety net, `jobs` periodically reconciles the local table against SendGrid's own suppression list (§10). That net is SendGrid-only, deliberately: Twilio exposes no equivalent queryable opt-out list for WhatsApp, so an inbound STOP lost to webhook failure has no second chance — accepted, with the generous webhook zone and logged signature failures keeping that window small. The `suppressions` the webhooks write are honoured by `jobs` before every send (§10) — the mechanism behind dependency register §3.15/§3.16.

**Transcription endpoints:** `POST /api/transcribe/draw` atomically assigns the next affidavit to the calling transcriber and returns it, drawing in priority order (§6); `POST /api/transcribe/{assignment-id}` submits a whole reading at once, **publishing every changed field through the normal publish path in one transaction** — the same `publishCandidateFieldTx` a curator edit uses — and marking each touched field checked. There is no staging table and no state machine between the transcriber and the public page. Both are per-account rate-limited like any other authenticated write.

**These two endpoints are the platform's only assignment-scoped privileged writes.** A transcriber has no ward scope: authorization is *"does an open assignment for this affidavit belong to this caller"*, checked against `transcription_assignments`, not against `canEditWard`.

**No privileged role is ward-scoped any more.** Curators became city-wide on 2026-08-15, so `canEditWard` (`src/lib/authz.ts`) has no remaining callers and per-ward authorization leaves the enforcement model entirely: `src/middleware.ts` answers curator and admin writes by role alone, and transcriber writes by assignment ownership. That is a removal, not the extra scopeless path an earlier version of this section described.

**Curator uploads** (affidavit PDF, candidate photo) are curator-only and per-account rate-limited, with size caps enforced twice — nginx `client_max_body_size` on the upload routes, re-checked app-side: **photos ≤ 2 MB, affidavit PDFs ≤ 20 MB**. Allowed types are an enumerated allowlist validated by magic bytes (§13); the file extension and client-supplied MIME type are ignored. Validation happens **before** the bytes are persisted, whichever store they land in — photos to Postgres, affidavit PDFs to the GCS bucket (§6).

**The EC-link fetch** (a curator pastes an affidavit URL and the platform fetches it) is the one server-side fetch of a user-supplied URL, and it is treated as an SSRF vector, not a convenience: `https` only; the target host must match an allowlist of official EC/CEO Karnataka domains; the resolved address is rejected if private, loopback, link-local, or the cloud metadata range (re-checked after each redirect, redirects capped); and the fetched bytes pass the same magic-byte and size validation as a direct upload before being written to the bucket (§6).

**Erasure (DPDP data-principal rights):** deletion requests arrive via the grievance contact and run an admin-triggered routine that deletes the OTP/session/contact data and consent records, and severs identity from what remains: the `users` row becomes an opaque tombstone, so `issue_votes` and `flags` keep their aggregate value with no path back to a person. Once off-box backups exist — none do yet (§10) — erased data will persist in them until they age out under the retention policy; that caveat is stated in `/privacy`.

**One OTP mechanism, two session lengths.** Every role signs in the same way — a one-time code, no passwords, no 2FA, no sign-in links. Citizens may use email or WhatsApp; **staff (admin, curator, transcriber) use email only**, so no privileged login depends on WhatsApp, Meta verification, or template approval. It does depend on SendGrid, which is therefore a hard prerequisite of the whole curator/transcriber operation and not merely of the campaign sends.

Sessions are signed cookies with `HttpOnly; Secure; SameSite=Lax`. **Citizens get a sliding 1-hour idle timeout; staff sessions last 24 hours from sign-in**, so an operator authenticates once a working day and never mid-shift. Re-auth is the normal OTP flow in both cases. The longer staff window is the reason blocking must terminate live sessions rather than only future logins (§7 erasure and `/admin/users`): with a 24-hour session, "no new logins" would leave a revoked curator working for the rest of the day.

**One account per contact** is enforced by unique indexes on email and phone; the OTP request distinguishes login (known contact) from registration (new contact), so the Register/Login modal stays one flow. **Adding or changing an account contact** is an authenticated flow through the same OTP request/verify endpoints — the new contact is verified by its own OTP, with the same per-destination cooldowns. **The `/login` fallback's post-login return target** is validated as a same-origin relative path — a user-supplied absolute URL is discarded in favour of `/` — closing the open-redirect vector. One middleware enforces roles; the same middleware rejects unsafe methods that fail an `Origin`/`Sec-Fetch-Site` same-origin check, and server-rendered forms carry a synchronizer CSRF token for the no-JS paths (§13). Rate limiting is layered: nginx `limit_req` per IP on `/api/*` — **per-endpoint zones with high bursts, sized for carrier-grade NAT**, because much of Bengaluru's mobile traffic shares egress IPs (Jio/Airtel CGNAT) and a limit tight enough to stop abuse would 429 legitimate ward lookups on election day. Per-IP limits are therefore a coarse flood backstop only; the per-account app limits (OTP requests, flags, votes, media uploads) and the per-destination OTP cooldowns above carry the real abuse weight. The k6 test (§12) asserts legitimate-shaped traffic sees no 429s at election-day volume.

**There is no rollback.** The `/admin/audit` viewer and its per-entry *restore this value* action were removed on 2026-08-15 with the log they read from. A wrong published value is corrected by publishing over it — by a curator, or through an accepted citizen flag — not by restoring a previous one. Nothing in the platform can tell you what a field held yesterday.

## 8. SEO / AEO

- Complete HTML at first byte for all public content — no client-side rendering of content.
- **JSON-LD** per page type: `Person` (candidates), `Place`/`AdministrativeArea` (wards), `Event` (the election), `FAQPage` (voting guides, check-registration), `Organization` (Oorvani, on `/about`), `BreadcrumbList` throughout.
- Per-language **sitemaps** with `lastmod` from publish timestamps, regenerated by `jobs`; `robots.txt`; canonical URLs.
- `noindex` and sitemap exclusion: `/partner/{slug}` (unlisted), `/account/*`, `/curator/*`, `/admin/*`, `/login`.
- **Open Graph tags on every page** in that page's language — distribution is WhatsApp forwarding, so the link preview is the first impression.
- AEO: a concise factual summary block at the top of ward/candidate/guide pages; question-shaped headings on guides; an `llms.txt` index; facts in visible text, not behind interaction.
- Pre-notification candidate routes return **200 with the empty-state content**, so shared URLs accumulate authority before data lands. Withdrawn and scrutiny-rejected candidates likewise stay **200 with their status banner** — the shared links keep resolving; only unknown slugs 404.

## 9. Bilingual content: three text layers

| Layer | Lives in | Kannada generated | Reviewed by |
|---|---|---|---|
| UI strings | repo (`en.json` / `kn.json`) | dev-time script | PR review |
| Editorial pages (guides, about-election, home copy) | repo (Markdown per locale: `content/pages/en/…`, `content/pages/kn/…`) | dev-time script | PR review |
| Curator data (report cards, ward issues) | Postgres (`value_en` / `value_kn`) | at publish, runtime | nobody — citizen flags are the correction path (a decided trade) |

No layer translates at request time; every render is from stored text.

**Dev-time script** (`npm run translate`): finds missing or stale Kannada files/keys (staleness = hash of the English source stored in the KN file's frontmatter), drafts them via the Anthropic API, writes ordinary files. Output is committed and diffable. **Regeneration is unconditional:** every English change regenerates its Kannada — there is no skip mark, and hand-edits to generated output are overwritten on the next source change, so they are not the correction path. Corrections live in **translation hints**: editable instructions in the English file's frontmatter (or, for UI strings, a hints entry beside the key) naming the specific sentence or word and how to render it — e.g. *"render 'report card' as ವರದಿ ಪತ್ರ, not a literal translation"*. Hints are included in the prompt on every regeneration, so a fix survives all future English edits. A fix that should apply site-wide belongs in the shared glossary instead (below).

**Glossary:** one repo file of canonical Kannada renderings for recurring terms — party names, corporation names, "corporator", "ward", "affidavit" — included in the prompt by **both** the dev-time script and the runtime curator-data path, so the same term never renders two ways in different parts of the site. Effectively the site-wide layer of the hints mechanism.

**Staleness check** (`npm run translate -- --check`): exits non-zero when any `kn/` file or key is missing, or its stored English-source hash no longer matches. The check only compares hashes; it makes no API calls, so it needs no Anthropic key. This was a CI gate that blocked the merge of an English-only or out-of-date `/kn/` page; with CI removed (§14.4) it is a manual pre-deploy step, and nothing now prevents such a page from being committed.

**Runtime path (curator data), per field:**

1. Curator publishes a field. One transaction writes the authored value, `authored_lang` and `translation_status = pending`. The authored-language page is live immediately — publish never blocks on translation.
2. In-request (≈5 s timeout), the app calls the Anthropic API to translate the changed field(s) only, with context: field name, candidate/ward, and the shared glossary (above). Success writes the other language's value, `translation_status = done`, plus model + timestamp.
3. On failure the field stays `pending` — rendered in the authored language with the untranslated indicator — and `jobs` retries every few minutes.
4. A curator may edit the Kannada value directly (e.g. resolving a translation flag): that sets `translation_status = manual`, excluding the field from MT until the source value changes again, which regenerates it (the manual fix described the old source text). MT regeneration happens silently.

Never machine-translated: official bilingual data (ward names arrive with Kannada names) and UI strings.

## 10. Jobs, ops, backups

- `jobs` runs the fixed campaign calendar against SendGrid/Twilio, honouring the language preference, channel toggles, and the `suppressions` table (§7); plus translation retries, sitemap regeneration, and a periodic reconciliation of `suppressions` against SendGrid's own suppression list — the safety net if a webhook event is ever lost (§7). **There is no per-ward readiness gate**: it was dropped on 2026-08-15, so candidate sends go to every ward on the calendar date, and *when* those sends are scheduled is the only thing accounting for uneven coverage across 369 wards.
- **Retention enforcement is a job, not a promise.** Once the retention period is legally confirmed (proposed: contact data deleted or anonymized within 3 months of results being declared), a `jobs` task applies the §7 erasure routine in bulk at expiry, and — once off-box backups exist (see the deferral below; none do today) — the restic retention policy will age the encrypted backups out on the same clock. Until the period is confirmed the job cannot be written, which is one more reason the retention decision sits at the head of the legal chain that gates M4 and M7.
- Structured logs to stdout via Compose logging, with `logging` options capping size and rotating files (Docker's default driver never rotates — an unbounded disk consumer otherwise); a healthcheck endpoint.
- **Monitoring is external and minimal — and currently incomplete.** *Revised 2026-08-13:* the DigitalOcean Uptime checks this section previously specified (liveness probes plus an **SSL-expiry alert** on the production hostname) went away with DigitalOcean, and **no replacement has been chosen** (`docs/project-dependencies.md` §6.14). State the consequence plainly: a silently failed certbot renewal now surfaces as an outage on expiry day rather than as a warning weeks earlier. The daily `nginx -s reload` (§14.5) still picks up *successful* renewals; it is the failure path that lost its alarm. **Sentry (free tier), server-side only** — `app` and `jobs` report errors; there is no client-side Sentry, so no added JS and no CSP change; event content is scrubbed per §13. The OTP-send and geocode budget alarms (§13) are SendGrid emails to the ops address. Compose logs remain the forensic layer, within the §13 content rules.
- **Backup success is verified, not assumed — once there is a backup to verify.** The mechanism is built and unchanged: after each nightly run `scripts/backup.sh` checks that `restic snapshots` actually gained one, then pings a dead-man's-switch (healthchecks.io); a missed ping emails ops. Without it, a wedged cron or an expired credential silently converts the accepted 24-hour RPO into unbounded loss. See the deferral below — that is the state the platform is in right now.
- **Disk has an owner.** One 193 GB disk carries two Postgres instances (media as bytea — now **candidate photos only**, ≤2 MB each; affidavit PDFs moved to Google Cloud Storage 2026-08-15, §6, which is what takes the nomination-window burst off this disk), the nginx cache, rotated logs (above), and locally built images. (`scripts/backup.sh`'s dump staging file would be a transient occupant too, removed after restic ships it — but right now nothing ships and nothing is removed: the script's required-variable check aborts before `pg_dump` ever runs, since the backup deferral above means `RESTIC_REPOSITORY`/`HEALTHCHECKS_URL` are unset — so it never gets far enough to write one.) — pruning superseded ones is now a manual step, and a careful one: `:previous` is the only rollback path (§14.3), so never prune blindly. **The disk-utilization alert is gone too.** It was another DigitalOcean mechanism (the stock metrics agent) and left with the provider — the same unresolved monitoring gap as the rest of §10 (`docs/project-dependencies.md` §6.14), with no replacement chosen. Nothing currently watches disk usage; exhaustion taking Postgres down mid-spike is a live risk, not a caught one.
- **Recovery targets, stated plainly.** RPO 24 hours: losing the box's disk loses up to a day of registrations, issue votes and flags — an accepted limitation (§13). RTO is hours, not minutes, in the intended steady state: rebuild from the §14.6 runbook plus a restic restore. There is no snapshot regime configured on this box to fall back on either — provider snapshots are not currently enabled (§13). Nothing shortens the data-loss window but the nightly dump's age. **As of 2026-08-13 this target is not met** — see the backup deferral above.
- **Off-box backup storage is UNRESOLVED, and this is a launch blocker.** *Revised 2026-08-13:* the restic repository was a DigitalOcean Spaces bucket in BLR1; moving to Hostinger (§14) left it with no home, and no replacement has been chosen (`docs/project-dependencies.md` §6.9). The requirements on whatever is chosen are unchanged: India-resident, and encrypted at rest — the nightly `pg_dump` contains DPDP-regulated personal data (contacts, home wards, consent records, identity-linked issue votes), which is why restic was chosen over rclone in the first place. Repository key held off-box, admin-only; restore rehearsed before it is needed (dependency register §6.9).
  - **Affidavit PDFs are the one exception, and only by accident of where they live.** Since 2026-08-15 they sit in Google Cloud Storage (§6) rather than in the dump, so they survive the box's disk regardless of the state of this row. Their durability comes from bucket object versioning, not from restic, and it does not extend to anything else: the `candidate_affidavits` rows pointing at those objects are still in Postgres, still in the dump, and still unprotected. A bucket that outlives its database is not a backup of the platform.
  - **Until it is resolved, production runs with no off-box backup at all.** The RPO below is not merely 24 hours — it is unbounded: losing the box's disk loses everything since seeding. The nightly cron entry (`deploy/crontab`) is deliberately left **active**, so `scripts/backup.sh` fails its `RESTIC_REPOSITORY` check and logs an error every night at 02:00. That noise is the point. Commenting the line out is how "we will wire backups later" becomes "we never wired backups".

## 11. Error handling

- Geocode ambiguity returns `ambiguous` ("be more specific") — the one failure the citizen can act on. Budget exhaustion, a Google failure, or a resolved ward missing from the DB return `unavailable`, phrased as our outage rather than a bad address. A point outside every GBA polygon returns the explicit out-of-coverage answer, not an error. **There is no fallback for typed addresses:** pincode was removed 2026-08-14 because its table never advanced past a placeholder, so geocoding is the only path from an address to a ward. The coordinate mode added the same day is the one path that degrades independently — it calls nothing and counts nothing, so it still answers during a geocoder outage, but only for a citizen with JS, a device position, and permission granted. Its own failure modes are local and never phrased as our outage: a refused permission and a device that cannot get a fix each point back at the address field.
- Booth lookup with no booth data loaded renders the guided link-out state, not an error.
- OTP send failure surfaces immediately with a retry.
- Unknown ward or candidate returns a real 404 page; pre-notification candidate routes return the 200 empty state; withdrawn/rejected candidates return 200 with the status banner (§8).
- Translation failure never blocks publish (see §9).

## 12. Testing

- Vitest for unit and route tests.
- Playwright smoke suite over the critical paths: lookup → ward page; OTP → vote; flag → curator accept → live; language toggle → `/kn/` equivalence.
- One k6 load test proving the nginx micro-cache holds election-day read volume on the actual VM size — asserting, too, that legitimate-shaped traffic through the CGNAT-sized rate limits (§7) sees no 429s.
- A route test asserting public GETs set no cookies and contain no session-dependent bytes — the guard on the §5 cache invariant.
- Route tests for the §7 webhook endpoints (invalid signatures rejected; a bounce event lands in `suppressions`) and for media ingest (over-size and off-allowlist uploads rejected).
- The translation staleness check (`npm run translate -- --check`, §9) is the guard on bilingual completeness. With no CI to enforce it (§14.4), it runs as a step of the manual pre-deploy check — a missing or stale `kn/` file is a release blocker, not a warning.

## 13. Security

Decided 2026-07-17 after a security review of this design. The per-mechanism details live in the sections above where they apply (§5 cache enforcement, §7 sessions/OTP/geocode, §10 backups, §12 tests); this section carries the cross-cutting rules and the limitations accepted deliberately.

- **CSRF:** `SameSite=Lax` cookies; middleware `Origin`/`Sec-Fetch-Site` check on all unsafe methods; synchronizer tokens on server-rendered forms (§7). Forged curator publishes are the worst outcome this design can produce, so this is not optional hardening.
- **OTP:** 5 verify attempts per code, then the code is invalidated. Per-destination request cooldowns — per email/phone: 1/minute, 5/hour, and a daily cap — because botnets defeat per-IP limits and per-destination limits are what stop SMS/WhatsApp pumping. A global daily send budget with an ops alarm bounds what an attack can cost. The cooldowns are themselves a targeted-DoS vector against named staff (anyone can burn a known curator or admin address's send budget), so they deny fresh *sends*, never login: a request during cooldown returns "a code was already sent", the earlier code stays valid — and it sits in the victim's own inbox, wherever the request came from — and an admin runbook step clears a destination's cooldown state. A sustained attacker can still burn each fresh code with five bad verifies until the daily send cap locks the destination for the day — the runbook step and the bounded window are the accepted answer; binding verify attempts to the requesting session was judged not worth the machinery yet.
- **Cost amplification:** the geocode cache stores normalized address → ward ID only — the platform's own derived conclusion, never Google's coordinates or response content (kept on privacy grounds now that dependency register §6.4 is closed — no longer a ToS stance, 2026-08-14). A daily geocode budget caps spend; since pincode lookup was removed (§11) exhausting it degrades availability, not cost. The Anthropic API needs no equivalent guard: only authenticated curator publishes and affidavit extraction trigger it, never public traffic. **Google Cloud Storage is the one metered service public traffic does reach** (§6): affidavit PDFs are publicly readable, so egress scales with citizens opening them. It is bounded by object count rather than by request rate — ~4,000 documents, each ≤20 MB — but a bucket-level egress budget with an alarm belongs alongside the geocode one, and does not exist yet (dependency register §6.19).
- **Headers:** nginx sets HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a CSP with `frame-ancestors 'none'` and per-request nonces for the two inline scripts (`?src` writer, GA). No `unsafe-inline`. On `/partner-with-us` only, the CSP additionally allows the reCAPTCHA script and frame hosts (`www.google.com`, `www.gstatic.com`) — §7.
- **Content rules:** flag text renders as text, always (citizen flag text shown in curator screens is a citizen→curator escalation path otherwise); every curator-supplied URL — `source_url` and the EC affidavit link — validated to `http(s)` schemes at write time (kills `javascript:` links); JSON-LD serialized with `<` escaped so curator data cannot close the script tag; MT output stored and rendered as plain text through normal escaping.
- **Logs & telemetry carry IDs, not identities:** application logs never contain lookup addresses, OTP destinations, or message recipients — opaque user/request IDs only; Sentry runs with default PII capture off and server-side scrubbing of contact and address fields (the requests most likely to error are exactly the ones carrying them). Log retention is bounded by the same retention decision as the rest of personal data. The same rigor already applied to the geocode cache, applied to the exhaust.
- **Cross-border processing, stated once:** Twilio, SendGrid, Google, Anthropic, and Sentry process personal data substantially outside India. DPDP §16 permits transfers absent a government restriction list, data-processing terms are executed with each vendor (dependency register §2.8), and the flows are enumerated in `/privacy`. Whatever off-box backup storage is eventually chosen must be India-resident (§10) — defense-in-depth for the copy at rest, not a claim the platform is India-resident end to end. That requirement is not yet satisfied by anything: there is no off-box copy today (§10). The **affidavit bucket is pinned to `asia-south1`** (§6) under the same rule, and unlike the backup destination that one is satisfiable immediately, because the bucket is being created rather than waited for. Note what it does *not* contain: affidavits are sworn public documents filed with the Election Commission, not citizen personal data in the DPDP sense the nightly dump carries.
- **Breach response is an obligation, not an option:** the DPDP Act requires notifying the Data Protection Board and affected data principals of a personal data breach. The procedure — decision timeline, Board notification, bilingual affected-user notice via the existing send infrastructure — is a runbook with a named owner (dependency register §2.9).
- **Uploaded media:** an enumerated type allowlist validated by magic bytes at ingest — PDF for affidavits; JPEG/PNG/WebP for photos, **no SVG** (a script container, and photos serve from the site's origin). Photos are served with `Content-Type` from the validated stored type and `nosniff`, so the media store cannot host other content types. Affidavit PDFs serve from the GCS bucket (§6) with `Content-Type: application/pdf` and `Content-Disposition` set as object metadata at write time — **the validation that makes that safe still runs app-side before upload**, so the bucket never receives an unvalidated byte. Size caps and upload rate limits: §7.
- **Secrets:** one `.env` outside the repo, mode 600, referenced by Compose; holds the vendor keys, session-signing key, and restic key reference. Rotation is a runbook step (custody: dependency register §6.10).
- **Accepted limitations, recorded deliberately:**
  - **There is no change history at all, and this is the largest accepted limitation in the design** (removed 2026-08-15, §6, §7). Nothing records who published a value, when, or what it replaced. Four decisions elsewhere in this platform were justified by the audit log and are now standing on the remaining nets alone: **city-wide unscoped curators** (any curator can change any field on any candidate), **one transcriber per affidavit with no second reading**, **publish-immediately with no approval gate**, and **machine-translated Kannada published unreviewed**. What is left is forward-only: a curator can correct any field, a citizen can flag any value, and `corrected_after_check` keeps a poor transcriber findable. What is gone is attribution and reversal — **an incorrect value on a candidate's criminal record has no recorded author and cannot be put back**, and the platform cannot answer "who changed this" for a journalist, a candidate, or a court. That is the trade, made knowingly.
  - Prompt injection into the MT/extraction calls (affidavit PDFs and curator text are adversarial inputs, and Kannada MT publishes unreviewed — a locked decision) is mitigated by escaping, a fixed extraction schema, visible provenance markers, and the citizen-flag correction path. No further machinery.
  - Staff sessions run 24 hours against a citizen's 1-hour idle timeout — a deliberate trade for operators working a shift, and the widest window an unattended browser gives an attacker; no session revocation on role change, no login notifications for privileged accounts — the short timeout carries the weight.
  - Backup isolation is currently moot: there is no off-box backup (§10). The prior decision — India residency for the DPDP-regulated dump beating disaster isolation, accepting that a region-wide provider failure would take the site and its backups together — stands as the rule for whatever storage is chosen next, but nothing satisfies it today. Provider snapshots, if enabled, share the box's provider and region too.
  - Backups are nightly only: up to 24 hours of registrations, issue votes and flags are lost if the box's disk dies (decided 2026-07-19). Affidavit PDFs are outside that window entirely since 2026-08-15 (§6) — they are in GCS, not in the dump — but the rows that reference them are not, so a 24-hour loss can still orphan a day's worth of ingested objects. WAL archiving would shrink the window to minutes and was rejected as a second backup mechanism to operate and rehearse — even election-week write volume was judged worth less than that operational load. Recovery targets: §10. Both of these describe the intended steady state; §10 records what is actually in place as of 2026-08-13.
  - Whoever deploys holds the keys to the box: deploys run as `root` (§14.4), so a compromised deploy key is full compromise of both stacks, production included (§14.2 shares the host). Accepted for a single-VM project; the mitigations are key-only SSH and ordinary key custody. Revised 2026-08-13 — this exposure was previously larger and automated (a CI system held the key and the staging deploy fired on every push to `main` with no approval gate, so a compromised Actions workflow or a malicious merge reached production). Removing CI (§14.4) removed that path; the trade is that nothing now gates a deploy except the person running it.
  - **Deploys run as `root` on the box** (§14.4). The prior design specified a dedicated key-only `deploy` user, but that user had to be in the `docker` group, which is root-equivalent on the host — so it read as privilege separation while providing none. Root SSH stays key-only with password authentication disabled. The real control is key custody, and it is worth saying that outright rather than implying an isolation boundary that never existed.

## 14. Deployment (Hostinger VPS)

Decided 2026-07-19; **provider revised 2026-08-13**. The single VM of §3 is a **Hostinger VPS**. Design history: `docs/superpowers/specs/2026-08-13-hostinger-deployment-design.md` for the provider move. The original 2026-07-19 DigitalOcean design document is no longer in the repo; the reasoning it carried — two environments on one box, images built from a checkout, forward-only migrations as an explicit deploy step — is restated in full in §14.2, §14.3 and §14.7 rather than cited.

### 14.1 Region & compute

One Hostinger VPS, **4 vCPU / 16 GB / 193 GB**, in **Mumbai** — the audience is Bengaluru; this is the closest India region on offer. This replaces the never-provisioned 2 vCPU / 4 GB BLR1 Droplet, and is materially larger than the size §12's k6 test was written to validate. That test still matters — it exercises nginx cache behaviour and rate-limit zone sizing, not just CPU — but the remediation if it falls short is a Hostinger plan upgrade rather than a Droplet resize.

**There is no Reserved-IP equivalent.** DNS points straight at the VPS's own address (`76.13.244.198`), so rebuilding or replacing the box requires a DNS change and a propagation wait — a real regression against the prior design, accepted because the alternative is a floating-IP product not offered at this tier. Keep record TTLs at 300 during any cutover. The box also has a global IPv6 address (`2a02:4780:12:4759::1`); `AAAA` records are published only once its public reachability is confirmed, because Let's Encrypt prefers `AAAA` when present and fails issuance if it cannot reach it.

### 14.2 Two environments, one box

Production and staging run as **two Compose projects** side by side:

- **One shared nginx container** (owned by the production stack; staging joins its network) terminates TLS for `bengaluruvotes.opencity.in` and `staging-bengaluruvotes.opencity.in` and proxies to the per-environment `app` containers.
- Staging has its **own `app`, `postgres`, and `jobs`** — nothing shared below nginx. Staging containers join only nginx's front network: **no route from any staging container to production Postgres**, so less-tested staging code cannot reach production data laterally. Staging Postgres is disposable: not backed up, safe to reset.
- **Staging `jobs` cannot message real people.** Its `.env` carries no production Twilio/SendGrid keys, and a `SENDS_DISABLED` flag makes the campaign runner log instead of send. Both guards, deliberately.
- **Staging is open to anyone with the URL** (changed 2026-08-13). Its server block sends `X-Robots-Tag: noindex` and nothing else — the `auth_basic` htpasswd that used to sit alongside it was removed on request, so what was a two-mechanism guard is now one, and that one binds only crawlers that choose to honour it. `deploy/deploy.sh` asserts the header on every staging deploy, because losing it is silent.

  **What is therefore public, stated plainly:** staging is seeded with `seed:dev` — 6 fictional candidates carrying "Demo Party A" / "(FICTIONAL)" labels, attached to the real 369 ward names — and it tracks `main`, so work merged but not yet released to production is visible there too. The on-page labels are what make the fixture data safe, and a cropped screenshot does not carry them; the platform's own distribution channel is WhatsApp forwards. Accepted knowingly as the cost of frictionless tester access. What staging still does **not** expose is unchanged and load-bearing: no real citizen data (369 wards is public data, 0 real candidates), no ability to message anyone (`SENDS_DISABLED=true` plus vendor keys omitted entirely), and no route to production Postgres.

  **Partly mitigated since:** staging carries a permanent full-bleed banner above the app bar reading "Testing site: Go away!" (design-system §7.14, `src/components/EnvBanner.astro`, selected by the `APP_ENV` runtime var in `deploy/compose.staging.yml`), so a screenshot of a staging page is no longer ambiguous unless it is cropped past the banner *and* the "(FICTIONAL)" label. Remaining mitigations in rough order of cost: dropping `seed:dev` from staging; an IP allowlist; or restoring `auth_basic` (needs the directive in `deploy/nginx/conf.d/site.conf`, the htpasswd bind mount in `deploy/compose.production.yml`, and step 5b of `deploy/runbook.md` — all three, or nginx fails its config load).
- Accepted trade (chosen over a second box): staging shares CPU and disk with production — and the kernel, Docker daemon, and deploying account (root, §14.4), which is the blast-radius limitation recorded in §13. Note that image builds now land on the box too (§14.3): a build is the heaviest thing that runs there, and it competes with live production traffic. Deploy off-peak, and never during election week without a reason. The 4 vCPU / 16 GB box (§14.1) makes this contention less acute than the 2 vCPU Droplet would have — not harmless.

### 14.3 Images & registry

Revised 2026-08-13: **there is no registry.** The `app` and `jobs` images are built **on the box** from a git checkout, by the same `Dockerfile` used everywhere else, and referenced by a purely local tag (`bengaluru-votes:${IMAGE_TAG:-latest}`). Nothing is pushed or pulled.

This replaces the original design (CI-built public GHCR images, the box pulls only). That design assumed an automated pipeline; with deploys run by hand (§14.4) a registry is a step that buys nothing — the box needs a checkout anyway to get the Compose files and `deploy/crontab`.

What the change costs, stated plainly:

- **Builds compete** with live production traffic (§14.2). A full `npm ci && astro build` is minutes of loaded CPU.
- **No immutable artifact.** Two builds of the same commit are not guaranteed byte-identical, and "the exact image a release ran" is no longer reproducible from a registry. Rollback (§14.4) depends on keeping the previous image *on the box* rather than on tag immutability.
- **Nothing else can pull the image** — an open-source civic project no longer publishes runnable artifacts. Reintroducing GHCR is a small change to §14.4 if that matters later.

Retagging is what makes rollback work: before each deploy the current image is tagged `:previous`, so the last-known-good is still resolvable after the new build overwrites `:latest`. Docker's image cache is the only store, so `docker image prune` is not safe to run blindly (§10's disk budget).

**Two checkouts, one per environment** (added 2026-08-13). Each stack builds from its own tree, so no ref juggling is needed and `git log -1` in either directory is an honest answer to "what is running here" — which a single shared checkout cannot give:

```
/root/src/bengaluru-votes-staging       tracks origin/main
/root/src/bengaluru-votes-production    detached on an annotated tag vYYYY.MM.DD
/etc/bengaluru-votes/.env.staging       mode 600, outside both trees
/etc/bengaluru-votes/.env.production    mode 600, outside both trees
```

The Compose project name is **pinned in each compose file** (`bengaluru-votes-production`, `bengaluru-votes-staging`). Compose would otherwise infer it from the directory holding the file — `deploy/` in both trees — merging the two stacks into one project namespace. Those names must never change on a live box: a new project name means a new, empty `pg_data` volume, which presents as the database having vanished.

**Promotion is a rebuild, never an image copy.** `astro.config.mjs` resolves `site` and `security.allowedDomains` at *build* time, so the staging and production images differ even at an identical commit. There is no promoting a verified staging artifact — production always rebuilds from the tag. This is also why the two stacks use distinct local tags (`bengaluru-votes-staging:*` vs `bengaluru-votes:*`): a shared tag would mean deploying staging silently swaps the image production restarts onto.

### 14.4 Release flow

Revised 2026-08-13: deploys are **manual**. There is no `.github/workflows/`; nothing deploys on push, on merge, or on release.

`deploy/deploy.sh` (committed) runs the whole sequence and verifies it:

```sh
deploy/deploy.sh staging                  # build+deploy origin/main
deploy/deploy.sh production v2026.08.14   # build+deploy that annotated tag
deploy/deploy.sh <env> --rollback         # retag :previous, restart, re-verify
```

What it does, per stack: preflight (ssh, tree exists and is clean, env file present) → tag the current image `:previous` **before** the build overwrites `:latest` → update that environment's tree to its ref → build with that environment's `SITE_ORIGIN` → migrate (§14.7) → `up -d` → **production only:** re-run `static-init` unconditionally → verify.

- **Branch policy:** **Staging is `origin/main`; production is a tag.** After staging verifies a commit, that exact commit is tagged `vYYYY.MM.DD` (`.2` for a second same-day release) and pushed; production checks it out detached. Tagging is the human judgement in the loop — nothing automates the decision that a commit is production-worthy.
- **Staging first.** With no pipeline enforcing it, "staging exercises every migration before production" (§14.7) is now a discipline rather than a property of the system. Deploy staging, check it, then production.
- **Versioning is date-based:** `vYYYY.MM.DD`, with `.2` appended for a second same-day release — the tag is not decoration: it is the ref production is checked out on.
- **Rollback:** `docker image tag <image>:previous <image>:latest` and `up -d` again. Never a schema step, because migrations are backward-compatible (§14.7) — `deploy/deploy.sh <env> --rollback` does this, restarts, and re-verifies.
- **Access:** SSH to the box as `root`, key-only, password authentication disabled. The prior design's dedicated `deploy` user is dropped — see §13 for why it was ceremony rather than privilege separation.
- **The tests are not gone, only unenforced.** `npm test`, `npm run typecheck` and `npm run translate -- --check` (§9) previously blocked a merge. Run them before deploying; nothing else will.

### 14.5 Network & TLS

Inbound 22, 80, 443 only, enforced by **`ufw` on the box** (the prior design used a DigitalOcean Cloud Firewall; Hostinger's panel firewall may be layered on top, but the committed anchor is `ufw` — `deploy/runbook.md`). SSH is key-only; password authentication and root password login disabled. TLS is Let's Encrypt via a **certbot container** in the production stack: HTTP-01 for both hostnames (nginx routes `/.well-known/acme-challenge/` to the shared webroot volume), certificates on a volume shared with nginx. The reload mechanism is chosen, not hand-waved: the nginx container runs a **daily `nginx -s reload` timer** — a no-op when nothing changed — so renewed certificates take effect without giving certbot a docker-socket mount. **What is missing:** the SSL-expiry alert that used to catch a silently failed renewal weeks early came from DigitalOcean Uptime and has no replacement (§10). "nginx terminates TLS" (§3) is unchanged.

### 14.6 Provisioning runbook

No Terraform — one box doesn't justify it. Provisioning is `deploy/runbook.md`:

1. Point DNS for both hostnames at the VPS's IPv4 (`A` only at first; `AAAA` after IPv6 reachability is confirmed — §14.1).
2. Harden the host: `ufw` allowing 22/80/443, SSH key-only, no password auth.
3. Install Docker Engine + Compose plugin.
4. Clone the repo twice (§14.3's per-environment trees); write the two `.env` files (mode 600, outside both checkouts — §13).
5. Bootstrap self-signed certs so nginx can start; bring production up; issue real certs; bring staging up. (No staging htpasswd step any more — basic auth was removed 2026-08-13, §14.2.)
6. **Run migrations on both databases** (`docker compose run --rm app npm run migrate`, and the staging equivalent) — neither compose file migrates on `up -d`, so skipping this leaves both databases schema-less and step 7's ward seed fails outright. This is first-provisioning-only; §14.7 covers migrations as an ongoing deploy step.
7. Seed wards on both, the first admin on production, demo content on staging.
8. Verify both hostnames **including a real POST** (§14.4), then retire the interim preview stack.
9. Initialize the restic repository and rehearse a restore — **blocked**: no backup target has been chosen (§10, dependency register §6.9).

Step 7's admin seed is the root of the authorization chain: a one-time CLI (`docker compose run --rm app npm run seed:admin -- <address>`) inserts the named admin identity, since OTP-only auth means role is nothing but a DB field. Every later role grant is an admin action in `/admin`; role is never inferred from the authenticating address.

### 14.7 Database migrations

Decided 2026-07-19.

- **Drizzle Kit generates SQL migration files**, committed and reviewed like any other code.
- The deploy sequence (§14.4) runs migrations as an explicit step between build and restart: `docker compose run --rm app npm run migrate`, using the just-built image. Deploying staging first therefore exercises every migration before production — a discipline now, not a property of the system, since no pipeline enforces the order.
- **Migrations are forward-only and backward-compatible** — expand, backfill, contract in a later release. The previous app image must run correctly against the new schema, so §14.4 rollback stays a pull-and-restart, never a schema downgrade.
- A failed migration aborts the deploy before any container restarts; the running version continues against the unchanged schema.

### 14.8 Running cost

VPS (already paid for, shared with other workloads) + **$0 backups and $0 monitoring — because neither exists yet** (§10). The prior estimate was ~$34–35/mo on DigitalOcean (Droplet $28 + Spaces $5 + snapshots $1–2). Whatever off-box backup storage is chosen (dependency register §6.9) adds a few dollars a month; an uptime/SSL monitor (§6.14) is free at the tiers this project needs. **The affidavit bucket (§6, dependency register §6.19) is new since 2026-08-15** and small at rest — a few GB of storage is cents — but its egress scales with citizens opening affidavits, which is the point of the platform; it is a line in §6.11's total, not a rounding error, and no quote has been taken. Messaging, geocoding, and Anthropic spend sit on top and remain the dominant unknown (§6.11).
