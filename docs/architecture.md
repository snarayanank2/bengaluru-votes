# Production Architecture

This document records the production architecture for the platform defined in `docs/prd.md` and `docs/information-architecture.md`. It answers: what runs where, what is cached, what is dynamic, and how the site stays fast, bilingual, indexable, and secure on a single VM with no CDN. Decided 2026-07-17.

---

## 1. Context & constraints

- **Hosting shape is decided:** a single VM running Docker Compose (`docs/project-dependencies.md` §6.1) — a DigitalOcean Droplet in BLR1; the full deployment design is §14. No CDN at launch; one may be added later.
- **Traffic shape:** overwhelmingly anonymous, read-only, spiking near election day. Content changes only when a curator publishes — not per request. Anonymous reads must stay fast with no login wall (PRD §12).
- **Team:** TypeScript/Node.
- **SEO/AEO is a requirement:** ward, candidate, and guide pages must be indexable by search engines and quotable by answer engines, in both English and Kannada.
- **Decided vendors** (dependency register §3, §6): Twilio/SendGrid for messaging, Google Geocoding server-side, MapLibre rendering, Anthropic API for Kannada machine translation and affidavit field extraction (PRD §5.2), Google Programmable Search (Custom Search JSON API) for candidate news-link suggestions (PRD §5.2; pipeline in §7), Google Analytics for visitor/event measurement (client-side snippet on public pages; static markup, so it does not break the one-cached-variant-per-URL invariant in §5).

## 2. Decision summary

| Decision | Choice |
|---|---|
| Application | One **Astro SSR monolith** (Node adapter, TypeScript): public pages, API endpoints, curator/admin screens |
| Database | **Postgres**, accessed via Drizzle; audit log as append-only table |
| Edge | **nginx**: TLS, static files, per-IP rate limiting, **micro-cache** for anonymous page GETs |
| Jobs | A **cron container** sharing the app codebase: send calendar, translation retries, backups |
| Language URLs | English at root, **Kannada under `/kn/`**, hreflang-linked; the toggle navigates between them |
| Spike strategy | nginx micro-cache (~60 s TTL on pages) — no purge machinery; CDN slots in front later unchanged |
| Geo | Ward polygons as static GeoJSON (MapLibre reads them directly) + in-memory point-in-polygon (Turf.js); **no PostGIS** |
| Client JS | Zero by default; islands only for modals, maps, and lookup forms |
| Deployment | **DigitalOcean Droplet (BLR1)**; staging + production on one box; images built on the box from a checkout; deploys run by hand (§14) |
| Migrations | **Drizzle SQL migrations**, forward-only and backward-compatible; run as an explicit deploy step before restart (§14.7) |
| Media | Curator uploads (affidavit PDFs, candidate photos) stored **as bytea in Postgres**, served at immutable content-hashed URLs (§6, §7) |
| News suggestions | `jobs`-driven Google Programmable Search over a repo-committed news-domain allowlist; suggestions are curator-only until approved, and approval is a normal audit-logged publish (§7) |
| Monitoring | **DO Uptime checks + server-side Sentry + email budget alarms** — external and minimal, nothing new on the VM (§10) |

Alternatives considered: a Next.js monolith with ISR (heavier runtime, React hydration on every page, more framework than 19 mostly-read routes need) and a fully static build plus separate API service (spike-proof reads, but "publish immediately" becomes a rebuild pipeline and one deployable becomes two). Both were rejected in favour of the lighter shape above.

## 3. System overview

Four Compose services on the single VM:

| Service | Role |
|---|---|
| `nginx` | TLS termination; serves static assets (built JS/CSS, ward GeoJSON, images, posters); micro-cache for anonymous HTML; `limit_req` rate limiting; compression; security headers (§13) |
| `app` | Astro SSR (Node). All routes: public pages, `/api/*`, `/account/*`, `/curator/*`, `/admin/*` |
| `postgres` | Single database |
| `jobs` | Cron-driven Node scripts: campaign sends, translation retries, sitemap regeneration, nightly `pg_dump` shipped off-box |

No Redis, no queue, no separate API service. Deploys build the image on the VM from a git checkout and restart (§14).

## 4. Routing & rendering

- Public pages are server-rendered to complete HTML with **zero client JavaScript by default**. Hydrated islands only for: the Register/Login, Flag, and Cast-vote modals; MapLibre maps; the address/pincode lookup; the booth lookup.
- **Language:** every public path exists twice — `/ward/57` (EN) and `/kn/ward/57` (KN) — via Astro i18n routing. The app-bar toggle links to the same page in the other language. Every page emits `hreflang` alternates and `x-default`. A cookie remembers the last choice so `/` can offer Kannada on entry — read **client-side** by a small script, like the `?src` writer (§5), because nginx strips cookies on public routes and the cached HTML is identical for everyone; the offer is a client-rendered banner, never a server-side variant. A registered user's saved preference governs notification language only (PRD §8).
- Curator, admin, and account screens are server-rendered forms with standard POSTs in the same app — no SPA.
- Modals are progressive enhancements over real routes, so the `/login` no-JS fallback comes free.

## 5. Caching & the election-day spike

nginx `proxy_cache` on anonymous-shaped GET HTML:

- Public pages: **~60 s TTL**. Issue-vote results and `/data`: ~5 min. `/api/*`, `/account/*`, `/curator/*`, `/admin/*`: `no-store`, never cached.
- **Invariant: public page HTML never varies by session.** Logged-in users receive the same cached anonymous markup; the three personalized elements (Sign-in vs Account control, register-for-updates slot, already-voted state) are swapped client-side from one `GET /api/me` call. The invariant is enforced, not assumed: **nginx strips the `Cookie` header** before proxying public-page routes, so the app cannot see a session on a cached path, and a route test asserts no `Set-Cookie` on public GETs (§12). Each URL has exactly one cached variant per language.
- **The cache key ignores the query string entirely** on public pages — unknown params can neither fragment the cache nor cache-bust it into a DoS on the origin. `?src={partner}` attribution still works: a small inline script reads `location.search` client-side and stores the slug in a cookie, which the registration endpoint reads (PRD §5.12).
- Worst-case origin load is every public URL rendered once per TTL — about 4,000 renders/minute at the absolute ceiling (369 wards × ~5 pages × 2 languages), well within one Node process. The spike lands on nginx, which serves cached responses at static-file speed.
- The 60 s window satisfies "curator edits go live immediately"; curators previewing edits use uncached curator routes.
- **Stale-while-restart:** `proxy_cache_use_stale error timeout updating` plus `proxy_cache_background_update` — cached public pages keep serving through the seconds an app restart takes (deploys, §14.4; a pre-election resize, §14.1) and through brief origin failures. Only uncached paths (`/api/*`, account/curator/admin) blip during a restart.
- **Uploaded media** (candidate photos, affidavit PDFs) is served at immutable content-hashed URLs (`/media/{id}/{hash}`, §7) with a long nginx cache TTL. An edit produces a new URL, so long-lived media caching coexists with the 60 s page TTL and the query-string rule above.
- **The Host header cannot poison the cache.** Every server-generated absolute URL — canonicals, `hreflang` alternates, `og:url`, JSON-LD `@id`, sitemap entries — derives from the fixed configured origin (Astro `site`), never from the request's `Host` or `X-Forwarded-Host`. nginx proxies only its named server blocks and passes a pinned `Host`; a default server rejects unmatched hosts. With output Host-independent, the path-plus-language cache key stays safe.
- A CDN added later sits in front of nginx with the same cache headers; the one required change is trust: nginx then takes client IPs for rate limiting from `X-Forwarded-For` via `real_ip`, restricted to the CDN's published ranges, so per-IP limits stay unspoofable.

## 6. Data model (sketch)

`wards` (id, name_en, name_kn, corporation, boundary ref) · `candidates` (slug, ward, party, photo → media, lifecycle status `filed|contesting|rejected|withdrawn` — PRD §5.2; a new row or a status transition is the "candidate-set change" that clears ward sign-off) · `candidate_fields` (candidate, field key, value_en, value_kn, authored_lang, translation_status, source_url, source_type `official|curator`) · `candidate_affidavits` (candidate, media ref, origin EC URL if fetched, extraction status; the stored copy is the public source link for affidavit fields, PRD §5.2) · `candidate_news_links` (candidate, url, title, domain, origin `auto|curator`, status `suggested|approved` — suggestions render nowhere public until a curator approves, PRD §5.2) · `media` (bytes as bytea, validated content type, sha256, size — candidate photos and affidavit PDFs, so the nightly `pg_dump` covers every curator upload with no second backup path) · `ward_issues` + per-candidate stances (deleting an issue cascades its vote-set entries; renaming keeps them — PRD §5.5) · `booths` (name_en, name_kn, address, location, ward) · `issue_votes` (user, ward, up to 3 issues; one active set per user, retired on home-ward change) · `users` (email and phone — each globally unique, either logs in, PRD §10; home ward, language, role, `src` attribution, consent record: timestamp + wording version + the optional future-civic-tools opt-in, PRD §10) · `otp_codes`, `sessions` · `suppressions` (contact, channel, reason `bounce|complaint|stop`; written by the §7 webhooks, honoured before every send) · `flags` (ward, dedupe key → count; the per-ward queue every covering curator sees, PRD §6.1) · `partners` · `eoi_submissions` · `ward_readiness` (completeness snapshot — counting only filed/contesting candidates, PRD §9.1; sign-off, cleared on candidate-set change) · `audit_log` (append-only; written in the same transaction as the change it records).

Sources are per-field (PRD §11). Ward boundaries are static GeoJSON — committed at **`data/gba.geojson`** (369 wards: polygons plus ward/corporation/zone/assembly/RO metadata, EN + KN names) — served by nginx and loaded into app memory at boot for point-in-polygon lookups; a `seed-wards` script maps its feature properties into the `wards` table. The pincode → ward shortlist table (§7) is likewise a build artifact, not a runtime table: generated by a repo script from official delimitation and postal data, committed, and served as static JSON.

## 7. API surface & auth

Public endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/ward-lookup` | Address → server-side Google geocode → point-in-polygon → ward. Returns a ward, never coordinates (Maps ToS constraint, dependency register §6.4) — or an explicit out-of-coverage answer when the geocoded point lands outside every GBA polygon (PRD §5.1). Normalized-address → ward-ID results are cached (our derived conclusion, no Google content stored); a global daily geocode budget degrades the endpoint to pincode lookup when exhausted (§11) |
| `POST /api/booth-lookup` | Same shape, booth data |
| `POST /api/otp/request`, `POST /api/otp/verify` | Email OTP (SendGrid); WhatsApp OTP when templates approve. Hashed 6-digit code, 10-minute expiry, 5 verify attempts per code (then invalidated); per-destination request cooldowns and a global daily send budget with an alarm (§13) |
| `GET /api/me` | Session state for client-side personalization |
| `POST /api/flags` | Gated write; dedupe; audit |
| `PUT /api/issue-votes` | Home-ward check; one active vote-set |
| `POST /api/eoi` | The one anonymous write; protected by **reCAPTCHA v3** (server-verified token + score; the script loads only on `/partner-with-us` — §13), disclosed in `/privacy` alongside GA |
| `POST /api/webhooks/sendgrid` | SendGrid event webhook: bounces and spam complaints write `suppressions` (§6). Signed-event verification |
| `POST /api/webhooks/twilio` | Twilio callbacks: WhatsApp delivery status; an inbound STOP suppresses the channel permanently. `X-Twilio-Signature`-verified |
| `GET /media/{id}/{hash}` | Uploaded media served from Postgres at an immutable content-hashed URL, long-TTL cached (§5); `Content-Type` comes from the validated stored type, never from the upload (§13) |

Pincode → ward shortlist is a static JSON lookup table — no API call.

Webhook endpoints are `no-store`, carry no session, and reject anything that fails signature verification. They get their **own generous `limit_req` zone**, deliberately not the general `/api/*` one: a campaign to 25,000 recipients returns bounce and delivery events from a handful of vendor IPs within minutes, and throttling that burst would silently drop suppression and STOP events. As a safety net, `jobs` periodically reconciles the local table against SendGrid's own suppression list (§10). That net is SendGrid-only, deliberately: Twilio exposes no equivalent queryable opt-out list for WhatsApp, so an inbound STOP lost to webhook failure has no second chance — accepted, with the generous webhook zone and logged signature failures keeping that window small. The `suppressions` the webhooks write are honoured by `jobs` before every send (§10) — the mechanism behind dependency register §3.15/§3.16.

**Curator uploads** (affidavit PDF, candidate photo) are curator-only and per-account rate-limited, with size caps enforced twice — nginx `client_max_body_size` on the upload routes, re-checked app-side: **photos ≤ 2 MB, affidavit PDFs ≤ 20 MB**. Allowed types are an enumerated allowlist validated by magic bytes (§13); the file extension and client-supplied MIME type are ignored.

**The EC-link fetch** (PRD §5.2 — a curator pastes an affidavit URL and the platform fetches it) is the one server-side fetch of a user-supplied URL, and it is treated as an SSRF vector, not a convenience: `https` only; the target host must match an allowlist of official EC/CEO Karnataka domains; the resolved address is rejected if private, loopback, link-local, or the cloud metadata range (re-checked after each redirect, redirects capped); and the fetched bytes pass the same magic-byte and size validation as a direct upload before storage.

**News-link suggestions** (PRD §5.2): a `jobs` task queries the **Google Programmable Search JSON API** per filed/contesting candidate (name + ward), every few days from N to E, against a **repo-committed allowlist of news domains** — the allowlist is the neutrality control, reviewable in a PR like any other change. Results are stored as `candidate_news_links` suggestions: title, URL, and domain from the API response only — no page content is fetched, so this is not a second SSRF surface. Suggestions render **only** on `/curator/candidate/{id}`; approval publishes the link as a normal audit-logged curator edit, and the same write-time `http(s)` URL validation applies as for hand-added links (§13). Query volume is bounded by candidate count × cadence (~1,500 contesting candidates city-wide ≈ a few hundred queries/day at a 2–3-day refresh) and capped by a **daily query budget with an ops alarm**, same pattern as geocoding (§13). If the budget or the API fails, suggestions simply pause — curator-added links are unaffected.

**Erasure (DPDP data-principal rights):** deletion requests arrive via the grievance contact (PRD §5.16) and run an admin-triggered, audit-logged routine that deletes the OTP/session/contact data and consent records, and severs identity from what remains: the `users` row becomes an opaque tombstone, so `issue_votes`, `flags`, and `audit_log` rows keep their aggregate and provenance value with no path back to a person. Audit *facts* survive; audit *identity* does not. Erased data persists in the encrypted nightly backups until they age out under the retention policy (PRD §17) — stated in `/privacy`.

Sessions are signed cookies with `HttpOnly; Secure; SameSite=Lax` and a sliding **1-hour idle timeout for all roles**; re-auth is the normal OTP flow. **One account per contact** (PRD §10) is enforced by unique indexes on email and phone; the OTP request distinguishes login (known contact) from registration (new contact), so the Register/Login modal stays one flow. **Adding or changing an account contact** is an authenticated flow through the same OTP request/verify endpoints — the new contact is verified by its own OTP, with the same per-destination cooldowns. **The `/login` fallback's post-login return target** (IA §7.1) is validated as a same-origin relative path — a user-supplied absolute URL is discarded in favour of `/` — closing the open-redirect vector. One middleware enforces roles and curator ward scope (PRD §7); the same middleware rejects unsafe methods that fail an `Origin`/`Sec-Fetch-Site` same-origin check, and server-rendered forms carry a synchronizer CSRF token for the no-JS paths (§13). Rate limiting is layered: nginx `limit_req` per IP on `/api/*` — **per-endpoint zones with high bursts, sized for carrier-grade NAT**, because much of Bengaluru's mobile traffic shares egress IPs (Jio/Airtel CGNAT) and a limit tight enough to stop abuse would 429 legitimate ward lookups on election day. Per-IP limits are therefore a coarse flood backstop only; the per-account app limits (OTP requests, flags, votes, media uploads) and the per-destination OTP cooldowns above carry the real abuse weight. The k6 test (§12) asserts legitimate-shaped traffic sees no 429s at election-day volume.

**Audit rollback** (PRD §11): the `/admin/audit` viewer carries a per-entry *restore this value* action — admin-only, per the PRD §7 matrix. Restore writes the prior value back as a **new publish**: same transaction, new audit entry, machine translation re-triggered (§9). Rollback is always a forward write; audit history is never edited.

## 8. SEO / AEO

- Complete HTML at first byte for all public content — no client-side rendering of content.
- **JSON-LD** per page type: `Person` (candidates, with `sameAs` news links), `Place`/`AdministrativeArea` (wards), `Event` (the election), `FAQPage` (voting guides, check-registration), `Organization` (Oorvani, on `/about`), `BreadcrumbList` throughout.
- Per-language **sitemaps** with `lastmod` from publish timestamps, regenerated by `jobs`; `robots.txt`; canonical URLs.
- `noindex` and sitemap exclusion: `/partner/{slug}` (unlisted, per IA §3.19), `/account/*`, `/curator/*`, `/admin/*`, `/login`.
- **Open Graph tags on every page** in that page's language — distribution is WhatsApp forwarding, so the link preview is the first impression.
- AEO: a concise factual summary block at the top of ward/candidate/guide pages; question-shaped headings on guides; an `llms.txt` index; facts in visible text, not behind interaction.
- Pre-notification candidate routes return **200 with the empty-state content** (PRD §13.1), so shared URLs accumulate authority before data lands. Withdrawn and scrutiny-rejected candidates likewise stay **200 with their status banner** (PRD §5.2) — the shared links keep resolving; only unknown slugs 404.

## 9. Bilingual content: three text layers

| Layer | Lives in | Kannada generated | Reviewed by |
|---|---|---|---|
| UI strings | repo (`en.json` / `kn.json`) | dev-time script | PR review |
| Editorial pages (guides, about-election, home copy) | repo (Markdown per locale: `content/pages/en/…`, `content/pages/kn/…`) | dev-time script | PR review |
| Curator data (report cards, ward issues) | Postgres (`value_en` / `value_kn`) | at publish, runtime | nobody — citizen flags are the correction path (decided trade, PRD §8) |

No layer translates at request time; every render is from stored text.

**Dev-time script** (`npm run translate`): finds missing or stale Kannada files/keys (staleness = hash of the English source stored in the KN file's frontmatter), drafts them via the Anthropic API, writes ordinary files. Output is committed and diffable. **Regeneration is unconditional:** every English change regenerates its Kannada — there is no skip mark, and hand-edits to generated output are overwritten on the next source change, so they are not the correction path. Corrections live in **translation hints**: editable instructions in the English file's frontmatter (or, for UI strings, a hints entry beside the key) naming the specific sentence or word and how to render it — e.g. *"render 'report card' as ವರದಿ ಪತ್ರ, not a literal translation"*. Hints are included in the prompt on every regeneration, so a fix survives all future English edits. A fix that should apply site-wide belongs in the shared glossary instead (below).

**Glossary:** one repo file of canonical Kannada renderings for recurring terms — party names, corporation names, "corporator", "ward", "affidavit" — included in the prompt by **both** the dev-time script and the runtime curator-data path, so the same term never renders two ways in different parts of the site. Effectively the site-wide layer of the hints mechanism.

**Staleness check** (`npm run translate -- --check`): exits non-zero when any `kn/` file or key is missing, or its stored English-source hash no longer matches. The check only compares hashes; it makes no API calls, so it needs no Anthropic key. This was a CI gate that blocked the merge of an English-only or out-of-date `/kn/` page; with CI removed (§14.4) it is a manual pre-deploy step, and nothing now prevents such a page from being committed.

**Runtime path (curator data), per field:**

1. Curator publishes a field. One transaction writes the authored value, `authored_lang`, `translation_status = pending`, and the audit entry. The authored-language page is live immediately — publish never blocks on translation.
2. In-request (≈5 s timeout), the app calls the Anthropic API to translate the changed field(s) only, with context: field name, candidate/ward, and the shared glossary (above). Success writes the other language's value, `translation_status = done`, plus model + timestamp.
3. On failure the field stays `pending` — rendered in the authored language with the PRD §8 indicator — and `jobs` retries every few minutes.
4. A curator may edit the Kannada value directly (e.g. resolving a translation flag): that sets `translation_status = manual`, excluding the field from MT until the source value changes again, which regenerates it (the manual fix described the old source text). MT regeneration is audit-logged as a system entry.

Never machine-translated: official bilingual data (ward names arrive with Kannada names) and UI strings.

## 10. Jobs, ops, backups

- `jobs` runs the fixed campaign calendar (`docs/gtm-plan.md`) against SendGrid/Twilio, honouring ward readiness (PRD §9.1), the language preference, channel toggles, and the `suppressions` table (§7); plus translation retries, sitemap regeneration, the news-link suggestion refresh (§7), and a periodic reconciliation of `suppressions` against SendGrid's own suppression list — the safety net if a webhook event is ever lost (§7).
- **Retention enforcement is a job, not a promise.** Once the retention period is legally confirmed (proposed: contact data deleted or anonymized within 3 months of results being declared — PRD §17), a `jobs` task applies the §7 erasure routine in bulk at expiry, and the restic retention policy ages the encrypted backups out on the same clock. Until the period is confirmed the job cannot be written, which is one more reason the retention decision blocks Phase 0.
- Structured logs to stdout via Compose logging, with `logging` options capping size and rotating files (Docker's default driver never rotates — an unbounded disk consumer otherwise); a healthcheck endpoint.
- **Monitoring is external and minimal** (decided 2026-07-19). DigitalOcean Uptime checks probe the healthcheck and one public page per language from outside the box, alerting ops by email — including an **SSL-expiry alert** on the production hostname (§14.5). A **disk-utilization alert** via the stock DO metrics agent is the one deliberate exception to "nothing on the VM" (see the disk bullet below). **Sentry (free tier), server-side only** — `app` and `jobs` report errors; there is no client-side Sentry, so no added JS and no CSP change; event content is scrubbed per §13. The OTP-send and geocode budget alarms (§13) are SendGrid emails to the same ops address. Compose logs remain the forensic layer, within the §13 content rules.
- **Backup success is verified, not assumed.** After each nightly run the backup script checks `restic snapshots` actually gained one, then pings a dead-man's-switch (healthchecks.io, free tier); a missed ping emails ops. Without this, a wedged cron or expired Spaces credential silently converts the accepted 24-hour RPO into unbounded loss.
- **Disk has an owner.** One ~80 GB disk carries two Postgres instances (media as bytea — bounded: ≤20 MB per affidavit, ≤2 MB per photo, across 369 wards' candidates), the dump staging file (removed after restic ships it), the nginx cache, rotated logs (above), and locally built images — pruning superseded ones is now a manual step, and a careful one: `:previous` is the only rollback path (§14.3), so never prune blindly. The DO disk alert (above) fires at 80% so exhaustion never takes Postgres down mid-spike.
- **Recovery targets, stated plainly.** RPO 24 hours: losing the Droplet's disk loses up to a day of registrations, issue votes, flags, and audit entries — an accepted limitation (§13). RTO is hours, not minutes: restore the weekly snapshot, or rebuild from the §14.6 runbook plus a restic restore. Nothing shortens the data-loss window but the nightly dump's age.
- Nightly `pg_dump` shipped off-box with **restic** — chosen over rclone because it encrypts at rest by default; the dump contains DPDP-regulated personal data (contacts, home wards, consent records, identity-linked issue votes). The restic repository is a **DO Spaces bucket in BLR1** — India-resident by choice (§14); the same-region trade is recorded in §13. Repository key held off-box, admin-only. Rehearsed restore (dependency register §6.9).

## 11. Error handling

- Geocode failure or ambiguity degrades to pincode lookup with a clear message; a point outside every GBA polygon returns the explicit out-of-coverage answer (PRD §5.1), not an error.
- Booth lookup with no booth data loaded renders the guided link-out state (PRD §5.10), not an error.
- OTP send failure surfaces immediately with a retry.
- Unknown ward or candidate returns a real 404 page; pre-notification candidate routes return the 200 empty state; withdrawn/rejected candidates return 200 with the status banner (§8).
- Audit-log write failure aborts the publish — same transaction.
- Translation failure never blocks publish (see §9).

## 12. Testing

- Vitest for unit and route tests.
- Playwright smoke suite over the critical paths: lookup → ward page; OTP → vote; flag → curator accept → live; language toggle → `/kn/` equivalence.
- One k6 load test proving the nginx micro-cache holds election-day read volume on the actual VM size — asserting, too, that legitimate-shaped traffic through the CGNAT-sized rate limits (§7) sees no 429s.
- A route test asserting public GETs set no cookies and contain no session-dependent bytes — the guard on the §5 cache invariant.
- Route tests for the §7 webhook endpoints (invalid signatures rejected; a bounce event lands in `suppressions`) and for media ingest (over-size and off-allowlist uploads rejected).
- A route test asserting unapproved news-link suggestions never appear in public HTML — the guard on the curator-only rule (§7).
- The translation staleness check (`npm run translate -- --check`, §9) is the guard on bilingual completeness. With no CI to enforce it (§14.4), it runs as a step of the manual pre-deploy check — a missing or stale `kn/` file is a release blocker, not a warning.

## 13. Security

Decided 2026-07-17 after a security review of this design. The per-mechanism details live in the sections above where they apply (§5 cache enforcement, §7 sessions/OTP/geocode, §10 backups, §12 tests); this section carries the cross-cutting rules and the limitations accepted deliberately.

- **CSRF:** `SameSite=Lax` cookies; middleware `Origin`/`Sec-Fetch-Site` check on all unsafe methods; synchronizer tokens on server-rendered forms (§7). Forged curator publishes are the worst outcome this design can produce, so this is not optional hardening.
- **OTP:** 5 verify attempts per code, then the code is invalidated. Per-destination request cooldowns — per email/phone: 1/minute, 5/hour, and a daily cap — because botnets defeat per-IP limits and per-destination limits are what stop SMS/WhatsApp pumping. A global daily send budget with an ops alarm bounds what an attack can cost. The cooldowns are themselves a targeted-DoS vector against named staff (anyone can burn a known curator or admin address's send budget), so they deny fresh *sends*, never login: a request during cooldown returns "a code was already sent", the earlier code stays valid — and it sits in the victim's own inbox, wherever the request came from — and an admin runbook step clears a destination's cooldown state. A sustained attacker can still burn each fresh code with five bad verifies until the daily send cap locks the destination for the day — the runbook step and the bounded window are the accepted answer; binding verify attempts to the requesting session was judged not worth the machinery yet.
- **Cost amplification:** the geocode cache stores normalized address → ward ID only — the platform's own derived conclusion, never Google's coordinates or response content (ToS stance: dependency register §6.4). A daily geocode budget degrades to pincode lookup when exhausted. News-suggestion queries (§7) carry the same daily-budget-plus-alarm guard, though the exposure differs: they are `jobs`-scheduled and bounded by candidate count, not reachable from public traffic. The Anthropic API needs no equivalent guard: only authenticated curator publishes trigger it, never public traffic.
- **Headers:** nginx sets HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a CSP with `frame-ancestors 'none'` and per-request nonces for the two inline scripts (`?src` writer, GA). No `unsafe-inline`. On `/partner-with-us` only, the CSP additionally allows the reCAPTCHA script and frame hosts (`www.google.com`, `www.gstatic.com`) — §7.
- **Content rules:** flag text renders as text, always (citizen flag text shown in curator screens is a citizen→curator escalation path otherwise); every curator-supplied URL — `source_url`, news links, the EC affidavit link — validated to `http(s)` schemes at write time (kills `javascript:` links); JSON-LD serialized with `<` escaped so curator data cannot close the script tag; MT output stored and rendered as plain text through normal escaping.
- **Logs & telemetry carry IDs, not identities:** application logs never contain lookup addresses, OTP destinations, or message recipients — opaque user/request IDs only; Sentry runs with default PII capture off and server-side scrubbing of contact and address fields (the requests most likely to error are exactly the ones carrying them). Log retention is bounded by the same retention decision as the rest of personal data (PRD §17). The same rigor already applied to the geocode cache, applied to the exhaust.
- **Cross-border processing, stated once:** Twilio, SendGrid, Google, Anthropic, and Sentry process personal data substantially outside India. DPDP §16 permits transfers absent a government restriction list, data-processing terms are executed with each vendor (dependency register §2.8), and the flows are enumerated in `/privacy` (PRD §5.16). The India-resident backup bucket (§10) is defense-in-depth for the copy at rest, not a claim the platform is India-resident end to end.
- **Breach response is an obligation, not an option:** the DPDP Act requires notifying the Data Protection Board and affected data principals of a personal data breach. The procedure — decision timeline, Board notification, bilingual affected-user notice via the existing send infrastructure — is a runbook with a named owner (dependency register §2.9).
- **Uploaded media:** an enumerated type allowlist validated by magic bytes at ingest — PDF for affidavits; JPEG/PNG/WebP for photos, **no SVG** (a script container, and these files serve from the site's origin). Served with `Content-Type` from the validated stored type, `nosniff`, and `Content-Disposition` for PDFs, so the media store cannot host other content types. Size caps and upload rate limits: §7.
- **Secrets:** one `.env` outside the repo, mode 600, referenced by Compose; holds the vendor keys, session-signing key, and restic key reference. Rotation is a runbook step (custody: dependency register §6.10).
- **Accepted limitations, recorded deliberately:**
  - The audit log is append-only at the application level only — database compromise defeats it; "immutable" (PRD §6) holds against application bugs and curator action, not against DB compromise. The nightly encrypted backups are the only historical copies. Hash chains and off-box audit streaming were considered and rejected as infrastructure the threat model doesn't yet justify.
  - Prompt injection into the MT/extraction calls (affidavit PDFs and curator text are adversarial inputs, and Kannada MT publishes unreviewed — locked decision, PRD §8) is mitigated by escaping, a fixed extraction schema, visible provenance markers, and the citizen-flag correction path. No further machinery.
  - Sessions have a uniform 1-hour idle timeout instead of per-role lifetimes; no session revocation on role change, no login notifications for privileged accounts — the short timeout carries the weight.
  - Backups share a region with the VM: the restic Spaces bucket sits in BLR1 alongside the Droplet, so a region-wide DigitalOcean failure loses the site and its backups together. India residency for the DPDP-regulated dump won over disaster isolation (decided 2026-07-19); weekly Droplet snapshots are the second layer, and they share the region too.
  - Backups are nightly only: up to 24 hours of registrations, issue votes, flags, and audit entries are lost if the Droplet's disk dies (decided 2026-07-19). WAL archiving would shrink the window to minutes and was rejected as a second backup mechanism to operate and rehearse — even election-week write volume was judged worth less than that operational load. Recovery targets: §10.
  - Whoever deploys holds the keys to the box: the `deploy` user's `docker` group membership is root-equivalent on the host, so a compromised deploy key is full compromise of both stacks, production included (§14.2 shares the host). Accepted for a single-VM project; the mitigations are key-only SSH and ordinary key custody. Revised 2026-08-13 — this exposure was previously larger and automated (a CI system held the key and the staging deploy fired on every push to `main` with no approval gate, so a compromised Actions workflow or a malicious merge reached production). Removing CI (§14.4) removed that path; the trade is that nothing now gates a deploy except the person running it.

## 14. Deployment (DigitalOcean)

Decided 2026-07-19. The single VM of §3 is a **DigitalOcean Droplet**; this section records the exact deployment shape. Design history: `docs/superpowers/specs/2026-07-19-digitalocean-deployment-design.md`.

### 14.1 Region & compute

One Premium AMD Droplet, **2 vCPU / 4 GB** (~$28/mo), in **BLR1 (Bengaluru)** — the audience is Bengaluru. A **Reserved IP** fronts the Droplet; DNS for both hostnames (below) points at it, so the box can be rebuilt without a DNS change. The k6 test (§12) validates the size against election-day volume; if it falls short, the plan is a vertical resize before election week — minutes of work — not year-round spike capacity.

### 14.2 Two environments, one Droplet

Production and staging run as **two Compose projects** side by side:

- **One shared nginx container** (owned by the production stack; staging joins its network) terminates TLS for `bengaluruvotes.opencity.in` and `staging.bengaluruvotes.opencity.in` and proxies to the per-environment `app` containers.
- Staging has its **own `app`, `postgres`, and `jobs`** — nothing shared below nginx. Staging containers join only nginx's front network: **no route from any staging container to production Postgres**, so less-tested staging code cannot reach production data laterally. Staging Postgres is disposable: not backed up, safe to reset.
- **Staging `jobs` cannot message real people.** Its `.env` carries no production Twilio/SendGrid keys, and a `SENDS_DISABLED` flag makes the campaign runner log instead of send. Both guards, deliberately.
- **Staging is invisible to the public:** its server block sends `X-Robots-Tag: noindex` and requires basic auth.
- Accepted trade (chosen over a second Droplet): staging shares CPU and disk with production — and the kernel, Docker daemon, and deploy user, which is the blast-radius limitation recorded in §13. Note that image builds now land on the box too (§14.3): a build is the heaviest thing that runs there, and it competes with live production traffic. Deploy off-peak, and never during election week without a reason.

### 14.3 Images & registry

Revised 2026-08-13: **there is no registry.** The `app` and `jobs` images are built **on the Droplet** from a git checkout, by the same `Dockerfile` used everywhere else, and referenced by a purely local tag (`bengaluru-votes:${IMAGE_TAG:-latest}`). Nothing is pushed or pulled.

This replaces the original design (CI-built public GHCR images, Droplet pulls only). That design assumed an automated pipeline; with deploys run by hand (§14.4) a registry is a step that buys nothing — the box needs a checkout anyway to get the Compose files and `deploy/crontab`.

What the change costs, stated plainly:

- **Builds compete with production traffic** on a 2 vCPU box (§14.2). A full `npm ci && astro build` is minutes of loaded CPU.
- **No immutable artifact.** Two builds of the same commit are not guaranteed byte-identical, and "the exact image a release ran" is no longer reproducible from a registry. Rollback (§14.4) depends on keeping the previous image *on the box* rather than on tag immutability.
- **Nothing else can pull the image** — an open-source civic project no longer publishes runnable artifacts. Reintroducing GHCR is a small change to §14.4 if that matters later.

Retagging is what makes rollback work: before each deploy the current image is tagged `:previous`, so the last-known-good is still resolvable after the new build overwrites `:latest`. Docker's image cache is the only store, so `docker image prune` is not safe to run blindly (§10's disk budget).

### 14.4 Release flow

Revised 2026-08-13: deploys are **manual**. There is no `.github/workflows/`; nothing deploys on push, on merge, or on release.

The sequence, run over SSH on the box, per stack:

1. `git fetch && git checkout` the intended ref.
2. `docker image tag <current> <image>:previous` — the rollback anchor (§14.3).
3. `docker compose -f deploy/compose.<env>.yml build`.
4. Migrate: `docker compose -f deploy/compose.<env>.yml run --rm app npm run migrate` (§14.7).
5. `docker compose -f deploy/compose.<env>.yml up -d`, then re-run `static-init` — it does **not** re-run on its own once it has completed successfully, and skipping it serves stale CSS/JS.
6. **Verify, including a real POST.** A stack built without the origin build args serves every GET with a healthy 200 and 403s every write; nothing in `ps`, the healthcheck or the logs shows it. `.claude/skills/deploy-vps/` automates exactly this sequence for the interim VPS and is the working reference.

- **Staging first.** With no pipeline enforcing it, "staging exercises every migration before production" (§14.7) is now a discipline rather than a property of the system. Deploy staging, check it, then production.
- **Versioning is date-based:** `vYYYY.MM.DD`, with `.2` appended for a second same-day release — still worth tagging in git so "how old is what's live" has an answer, even though no tag triggers anything.
- **Rollback:** `docker image tag <image>:previous <image>:latest` and `up -d` again. Never a schema step, because migrations are backward-compatible (§14.7).
- **Access:** a dedicated `deploy` user (key-only, `docker` group). The keys are now held by whoever deploys, not by a CI system — which removes the "CI holds the keys to the box" exposure in §13 and replaces it with ordinary human key custody.
- **The tests are not gone, only unenforced.** `npm test`, `npm run typecheck` and `npm run translate -- --check` (§9) previously blocked a merge. Run them before deploying; nothing else will.

### 14.5 Network & TLS

A **DO Cloud Firewall** allows inbound 22, 80, 443 only. SSH is key-only; passwords and root login disabled. TLS is Let's Encrypt via a **certbot container** in the production stack: HTTP-01 for both hostnames (nginx routes `/.well-known/acme-challenge/` to the shared webroot volume), certificates on a volume shared with nginx. The reload mechanism is chosen, not hand-waved: the nginx container runs a **daily `nginx -s reload` timer** — a no-op when nothing changed — so renewed certificates take effect without giving certbot a docker-socket mount. Silent renewal failure is caught weeks early by the DO Uptime SSL-expiry alert (§10). "nginx terminates TLS" (§3) is unchanged.

### 14.6 Provisioning runbook

No Terraform — one Droplet doesn't justify it. Provisioning is this runbook:

1. Create the BLR1 Droplet (Premium AMD 2 vCPU / 4 GB); attach the Cloud Firewall and Reserved IP.
2. Point DNS for both hostnames at the Reserved IP (under Oorvani's `opencity.in`, dependency register §6.8).
3. Install Docker Engine + Compose; create the `deploy` user (key-only, `docker` group).
4. Clone the repo; write the two `.env` files (mode 600, outside the repo — §13).
5. Run certbot once for both hostnames; start the production stack, then staging.
6. Initialize the restic repository against the Spaces bucket; rehearse a restore (dependency register §6.9).
7. **Seed the first admin:** a one-time CLI (`docker compose run --rm app npm run seed:admin -- <address>`) inserts the named admin identity — the root of the authorization chain, since OTP-only auth means role is nothing but a DB field. Every later role grant is an admin action in `/admin`, audit-logged; role is never inferred from the authenticating address.

### 14.7 Database migrations

Decided 2026-07-19.

- **Drizzle Kit generates SQL migration files**, committed and reviewed like any other code.
- The deploy sequence (§14.4) runs migrations as an explicit step between build and restart: `docker compose run --rm app npm run migrate`, using the just-built image. Deploying staging first therefore exercises every migration before production — a discipline now, not a property of the system, since no pipeline enforces the order.
- **Migrations are forward-only and backward-compatible** — expand, backfill, contract in a later release. The previous app image must run correctly against the new schema, so §14.4 rollback stays a pull-and-restart, never a schema downgrade.
- A failed migration aborts the deploy before any container restarts; the running version continues against the unchanged schema.

### 14.8 Running cost

Droplet ~$28 + Spaces ~$5 + snapshots ~$1–2 + monitoring & CAPTCHA $0 (DO Uptime, Sentry free tier, reCAPTCHA) ≈ **$34–35/mo** before messaging, geocoding, and Anthropic spend — a concrete input to the open total-budget question (dependency register §6.11).
