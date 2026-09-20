# AGENTS.md



## What is being built

**GBA Elections Citizen Platform** (`bengaluruvotes.opencity.in`) — a platform giving Bengaluru citizens ward-level information for the GBA (corporator) ward elections. Citizens find their post-delimitation ward, find their polling booth, read sourced candidate report cards, compare candidates, vote on the top-3 local issues, get voting logistics, and — after the poll — see their ward's result. Fully bilingual (English / Kannada), 369 wards.

This serves a real election. Demo/fixture data is deliberately unmistakable as fake (`scripts/seed-dev.ts` — "Demo Party A", "(FICTIONAL)"); never introduce plausible-looking fake candidate or party data.

**Out of scope this release:** promise/accountability tracking, ward budgets, civic-issue officer directory, remote voting, candidate outreach tooling.

## The docs

- `docs/overview.md` — stakeholder summary. Start here for the *why*: what the platform does, the five roles, the locked decisions, the dependencies, and §2's standing risk that the candidate data may not be obtainable at all.
- `docs/milestones.md` — **the plan of work**: fourteen milestones, what each ships, how it is tested, what it waits on. It tracks the **Milestones** tab of the project tracker sheet, which is the source; the doc is the reading of it. Replaced a nine-milestone plan on 2026-08-15, which had replaced `docs/project-plan.md`'s phases the day before — **every milestone number changed both times**, so treat any `M<n>` written before 2026-08-15 as pointing at the wrong milestone (`milestones.md` §17 maps them). When you need to know what is being built next and in what order, this wins.
- `docs/architecture.md` — the technical design. Section numbers referenced throughout the source (`architecture §5`, `§9`, `§13`) are load-bearing; code comments point at them.
- `docs/election-timelines.md` — what the election calendar allows, as offsets from **N**, the announcement. Deliberately self-contained and cited rather than copied: anything date-dependent points here so one update at N propagates. No date in it is confirmed.
- `docs/ksec-data-risk.md` — whether candidate affidavit data can be obtained at all. KSEC publishes no filled affidavits; this is the acquisition options and the risk. Read it before assuming candidate data exists.
- `docs/messages.md` (the seven citizen sends, EN and KN), `docs/design-system.md`, `docs/project-dependencies.md`.
- `docs/gcp.md` — Google Cloud credential provisioning (Geocoding, Maps JS, Places, reCAPTCHA, GA4; its Custom Search section is now dead — candidate news links were dropped 2026-08-15): what to create in which console and which env var it becomes. `deploy/runbook.md`'s env var table is the authority on what each variable does at runtime; `gcp.md` is how the values are obtained.

**Four documents were deleted on 2026-08-15, pending regeneration:** `prd.md` (product requirements — the former tiebreaker on ambiguity), `information-architecture.md` (the canonical route map), `gtm-plan.md` (campaign calendar) and `roles.md` (staffing). They were built on the superseded milestone structure and are being rewritten rather than renumbered. `overview.md` was deleted with them and has since been rewritten against the fourteen milestones — treat it as current. The other three are recoverable from git history (`git log --diff-filter=D -- docs/prd.md`, then `git show <commit>^:docs/prd.md`); `roles.md` was never committed and is gone from the repo.

**Until they return, `docs/overview.md`, `docs/milestones.md` and `docs/architecture.md` are the plan of record, and anything not stated in them or in the source is not written down.** Do not invent a requirement to fill the gap — ask. `docs/review.md` predates the deletions and refers to all five; treat it as history.

Source comments cite "Task NN" throughout — historical task briefs, mostly no longer in the repo. Treat them as provenance, not as files to find.

## Commands

```sh
npm run dev                 # astro dev
npm run build               # production build (see the SITE_ORIGIN warning below)
npm test                    # vitest, whole suite — requires DATABASE_URL
npm run typecheck           # astro check && tsc --noEmit
npm run migrate             # drizzle migrations, forward-only, idempotent
npm run translate -- --check  # bilingual staleness gate; no API calls, no key needed
npm run translate           # regenerate stale Kannada via the configured translation backend; normally use Codex for translations
```

Single test file / single test:

```sh
npx vitest run tests/routes/ward.test.ts
npx vitest run tests/unit/otp.test.ts -t 'name of the case'
```

Seeds (order matters — `seed:dev` depends on wards existing):

```sh
npm run seed:wards          # the real 369 wards, from data/gba.geojson
npm run seed:dev            # fictional demo content; REFUSES under NODE_ENV=production
npm run seed:admin -- <email>   # idempotent; the ONLY place a user becomes 'admin'
```

### Running the app locally

```sh
docker compose -f deploy/compose.local.yml up --build -d   # http://localhost:4321
```

Builds from the working tree; runs migrations automatically; seeding is manual (commands in the file's header). The other two Compose files (`compose.staging.yml`, `compose.production.yml`) target the VPS — they build the same Dockerfile but add TLS nginx, certbot and the jobs container, and expect real credentials, so they won't come up on a laptop.

### Tests need a database

Every DB-backed test reads `DATABASE_URL` and throws without it — the guard in each file points back here. Tests need a database **separate from the one the local app stack uses**, since they truncate and re-seed freely. Run the suite inside the local Compose app image so the test runner uses the same Node/npm environment as the app:

Create the test database once:

```sh
docker compose -f deploy/compose.local.yml up -d postgres
docker compose -f deploy/compose.local.yml exec postgres \
  createdb -U gba bv_test    # password: gba_local_dev; ignore "already exists"
docker compose -f deploy/compose.local.yml exec postgres \
  createdb -U gba bv_e2e     # only needed for Playwright
```

Then, for any Vitest run:

```sh
docker compose -f deploy/compose.local.yml run --rm --no-deps --build \
  -e DATABASE_URL=postgres://gba:gba_local_dev@postgres:5432/bv_test \
  app npm test
```

For a single test file or test case, replace `npm test` with the relevant `npx vitest run ...` command from above. Migrations run automatically — each DB-backed test file calls `migrate()` in its own `beforeAll`. Never point this command at the app's `gba` database.

`vitest.config.ts` sets `fileParallelism: false` and `singleFork` on purpose: all DB-backed tests share one database, and parallel files race (a temporary DDL rule in `audit.test.ts` — until tracker 147 removes it — breaks other files' `INSERT ... RETURNING`; fixture ids collide). Don't re-enable parallelism.

### E2E (Playwright)

Three steps, in order — the first is not `npm run build`:

```sh
npm run build:e2e                                  # sets E2E_ALLOWED_HOST/_PORT for THIS build
DATABASE_URL=<...>/bv_e2e npm run seed:e2e         # migrates, seeds, writes tests/e2e/.fixtures.json
npm run test:e2e
```

E2E uses a dedicated `bv_e2e` database, never `bv_test`: `seed-e2e` picks wards by `ORDER BY id ASC LIMIT 3`, so leftover fixture rows from the vitest suite would make it nondeterministic.

## Architecture

Astro SSR monolith (TypeScript, `output: 'server'`, `@astrojs/node` standalone) + Postgres via Drizzle + an nginx micro-cache + a `jobs` cron container, on single-VM Docker Compose. No other frameworks or services without asking.

### Route twins (bilingual)

Every screen is **one component in `src/features/pages/` taking a `lang: 'en' | 'kn'` prop**. Files under `src/pages/` are thin route shims that render it — `src/pages/<path>.astro` with `lang="en"`, `src/pages/kn/<path>.astro` with `lang="kn"`. English at root, Kannada under `/kn/`, hreflang-linked. See `src/features/pages/README.md`.

Adding a page means touching three files (feature component + two shims). API routes and `/media` are not localized.

**Status codes must live in the route shim, not the feature component.** Only page-level frontmatter can end a request with a custom status; a `Response` returned from a child component is ignored. That's why `src/pages/ward/[id].astro` does its own existence check before rendering `Ward.astro`.

### `src/middleware.ts` — the single enforcement point

Session, CSRF, role authorization, CSP, and cache-safety all run here, before any route. Read its docstring before changing anything security-adjacent; it defines the route classes (public / `/account`+`/curator`+`/admin` / `/api/webhooks` / `/api/otp` / other `/api`) and their differing rules.

Two invariants worth stating outright:

- **It never calls `cookies.set`/`cookies.delete`, on any route.** That omission *is* the cache-safety guarantee (public GETs never set a cookie). A route test asserts it.
- **Per-ward curator scope is not checked here.** The middleware only knows the route class, not which ward an edit targets. Call `canEditWard` (`src/lib/authz.ts`) where the ward id is known.

### The caching invariant

**Public page HTML never varies by session.** nginx strips the `Cookie` header before proxying public routes, so the app cannot see a session there even if it wanted to. Logged-in users get the same cached anonymous markup; account and registration state is swapped client-side from `GET /api/me`; anonymous voting state comes from `GET /api/issue-votes` using an opaque HttpOnly receipt cookie. The cache key ignores the query string entirely.

Anything that would make a public page depend on the viewer breaks this. Personalize through `/api/me` instead.

### Islands

Client-side code is vanilla TypeScript in `src/islands/` — no UI framework. CSP is `script-src 'self' 'nonce-…'` with no `'unsafe-inline'`, built by the app (`src/lib/csp.ts`), not nginx.

`astro.config.mjs` sets `vite.build.assetsInlineLimit: 0` **because of this**: Astro silently inlines small hoisted scripts into the HTML with no nonce, and real browsers then block them — the islands never run, and the failure is invisible server-side. Don't raise that limit.

### Bilingual text — three separate layers

| Layer | Lives in | Kannada from |
|---|---|---|
| UI strings | `src/i18n/en.json` / `kn.json` | dev-time `npm run translate` |
| Editorial pages | `content/pages/en/*.md` / `kn/*.md` | dev-time `npm run translate` |
| Curator data | Postgres (`value_en` / `value_kn`) | at publish, runtime (`src/lib/translate-runtime.ts`) |

No layer translates at request time. Regeneration is unconditional — **hand-edits to generated Kannada are overwritten**; corrections belong in translation hints (frontmatter / `__hints`) or `src/i18n/glossary.json`. CI fails on a missing or stale `kn/` file or key.

For editorial or UI translation work, use Codex to author the Kannada translation directly and preserve the generated `sourceHash` / `__hashes` metadata. Use `npm run translate -- --check` as the final staleness and hash gate. Do not depend on the local Claude CLI or an Anthropic API key for routine translation work; the configured translation backend is a fallback for regeneration when explicitly needed.

`t()` throws on a missing key unless *both* `import.meta.env.PROD` and `NODE_ENV=production` agree — so dev and tests surface missing translations loudly.

### Curator publishing

Curator edits **go live immediately** — no approval gate. Every field carries a visible source, distinguishing official/affidavit data from curator-compiled context. `src/lib/publish.ts` owns the publish path (including manual-override vs source-change MT regeneration).

**The audit log was removed on 2026-08-19** (tracker 147; `docs/architecture.md` §6, §7, §13) — no change history, no `/admin/audit`, and no restore action. Migration `0008_remove_audit_log.sql` drops the legacy table; `0001_audit_append_only.sql` remains only as immutable migration history.

### Contribution flows

**Keep anonymous voting.** Issue voting requires no account or registered home ward: a visitor chooses exactly three issues in one ward, with one immutable ballot per browser receipt and results revealed after voting. Flagging misinformation remains login-gated, works across any ward, and **the original action resumes in place** after auth. Both actions show enabled buttons to anonymous users.

Register/Login (fallback page `/login`) and Flag are **modals** that overlay without changing the URL. **Issue voting is inline** in the ward’s “What matters most in this ward” section: show the choices, selection count, submission, and feedback in place, without a popup. Keep anonymous voting and the exactly-three limit. After voting, show results immediately in place; also show them automatically on return visits with a valid receipt, without requiring a “Show results” click. In the voted state, replace the voting instructions with a results subtitle, show the receipt’s three choices, then show only the top five overall issues with votes. Keep the original instructions for visitors who have not voted. Every other screen is a distinct deep-linkable URL.

### Roles

Anonymous citizen (no account, most traffic, read-only) · Registered citizen · Data curator (**scoped to assigned wards/zone**) · Admin (city-wide). `roleEnum` in the schema is the authority on what exists today; `src/middleware.ts` and `src/lib/authz.ts` are the authority on what each can do. There is no written permissions matrix at present.

A fifth role, **transcriber**, is planned but not built: city-wide, *scopeless*, so `canEditWard` will not apply to it and authorization becomes "does an open assignment for this affidavit belong to this caller". That is a change to the enforcement model, not a new row in a table — see `docs/milestones.md` §10 before implementing it.

## Gotchas that bite silently

- **`SITE_ORIGIN` / `EXTRA_ALLOWED_ORIGIN` are build-time.** `astro.config.mjs` resolves `site` and `security.allowedDomains` once, at build, against two hard-coded `*.opencity.in` hostnames. An image built without them for any other host serves every GET with a healthy 200 and **403s every POST** — nothing in `docker compose ps`, the healthcheck, or the logs indicates it. Any deploy verification must include a real POST.
- **Address lookup has no fallback.** Pincode lookup was removed 2026-08-14 (`src/pages/api/ward-lookup.ts` header): the table behind it never advanced past a 12-row placeholder, so it told citizens to try something that could not work. Google geocoding is the *only* path from a typed address to a ward — exhausting `GEOCODE_DAILY_BUDGET` (default 2000/day, deliberately unchanged) or a Google outage takes that mode down, and the citizen sees an explicit "try again shortly" message. There is no browsable ward list to fall back to. The endpoint's **second input mode**, `{lat, lng}` from the home page's "use my current location" control, is the one path that survives such an outage: `lookupWardByPoint` goes straight to point-in-polygon, calling nothing and spending nothing. Don't route it through the geocoder or give it a cache row — the citizen's position is used once and dropped.
- **The ward map (Google Maps JS API, `src/islands/WardMap.ts`) needs three env vars to render at all**, not one: `MAPS_ENABLED` exactly `'true'` *and* a non-empty `GOOGLE_MAPS_BROWSER_KEY` *and* a non-empty `GOOGLE_MAPS_MAP_ID` (`src/lib/maps-config.ts`'s `mapsConfig().enabled`). Miss any one of the three and the map silently doesn't mount — `Ward.astro` renders the server-side fallback text instead, with no error anywhere. The same key also gates Places Autocomplete on the home-page ward-lookup form.
- **`/data/gba.geojson` is not in `public/`.** Production serves it from the nginx static volume, populated by the `static-init` one-shot, which **does not re-run** on `up -d` once it has succeeded — stale CSS/JS after a deploy usually means it needs `docker compose run --rm static-init`.
- Unset vendor keys (`SENDGRID_*`, `TWILIO_*`, `GOOGLE_*`, `ANTHROPIC_API_KEY`, `RECAPTCHA_*`, `SENTRY_DSN`) each degrade to a documented no-op rather than an error. `deploy/runbook.md` has the exhaustive table with what each one's absence costs.
- **No off-box backup exists.** The nightly `scripts/backup.sh` cron fails every night by design until a restic target is chosen (`architecture.md` §10, dependency register §6.9). Losing the box's disk loses everything. Don't read the working backup *mechanism* as a working backup.

## Fixed decisions (don't relitigate without asking)

- **Auth:** one email / WhatsApp OTP mechanism for *all* roles. No passwords, no 2FA, no sign-in links. **Staff (admin, curator, transcriber) are email-only**; only citizens get the WhatsApp channel. **Sessions: 24h for staff, 1h sliding idle for citizens.** `npm run seed:admin` bootstraps the first admin. Consequence worth holding: **SendGrid gates the entire curator/transcriber operation**, not just the campaign sends — but Meta/WhatsApp does not, so the 40-day queue is not in that path.
- **Curator publish:** trusted; immediate, no approval gate.
- **Bilingual:** EN at root, KN under `/kn/`, each with its own URL.
- **Deployment:** one Hostinger VPS (Mumbai, 4 vCPU / 16 GB) runs production Compose, from `/root/src/bengaluru-votes-production`. The staging site/stack was intentionally retired on 2026-09-18 and may be recreated later. **There is no CI and no registry** (removed 2026-08-13): images are built on the box, and production deploys are run by hand with `deploy/deploy.sh production <tag>`. In conversation, “deploy to VPS” means production directly; do not deploy staging unless explicitly requested. Nothing fires on push, merge or release. `deploy/runbook.md` ("Deploying") is the procedure; `architecture.md` §14.3/§14.4 is the design. Moved off the never-provisioned DigitalOcean Droplet on 2026-08-13.
- **Consequence worth holding onto:** `npm test`, `npm run typecheck` and `npm run translate -- --check` no longer gate anything. Run them before deploying — nothing else will.
- **Staging isolation:** `compose.staging.yml` must never join `back_prod`, and staging must keep `SENDS_DISABLED=true` with vendor keys omitted entirely. Those are two independent guards; keep both.

## Parallel Codex sessions

Use normal Codex CLI sessions for implementation; do not route work through a mandatory subagent or coordinator workflow. Multiple Codex sessions may work in parallel, but they must never edit the same checkout or branch at the same time.

Every new Codex session must start its own instance of Docker Compose, configured to listen on a different host port from other active sessions. After starting it, present the resulting review URL to the user so they can inspect the changes directly.

For parallel work, create one project-local `.worktrees/<short-task-name>` worktree and one descriptive branch (for example, `codex/<short-task-name>`) per session. Verify `.worktrees/` is ignored before creating it. Each session owns its worktree, keeps its changes focused, and reports its branch, commit, tests, and limitations. Do not use `git reset --hard`, `git checkout --`, or broad cleanup commands in a shared checkout.

Keep the primary checkout for integration and release work. Before merging or cherry-picking another session's commit, inspect its diff and check that the target branch has no unrelated uncommitted changes. Integrate independent commits one at a time, resolve conflicts in the primary checkout, run the relevant verification, and only then push or deploy. If two sessions touch overlapping files, stop one or coordinate explicitly before integration; never rely on concurrent edits resolving themselves.

Sessions may run tests and local servers independently, but use distinct ports, databases, and temporary files where applicable. Never point destructive test commands at another session's database or at the production database.

Open questions: `docs/milestones.md` §17 (what the plan and the tracker still disagree about), `docs/election-timelines.md` §5 (what nobody has confirmed about the calendar), `docs/ksec-data-risk.md` §6 (whether the candidate data can be got at all). The consolidated product open-questions list went with `prd.md` and has not been reconstructed — check the three above before inventing an answer, and ask if it is not there.

## Learning from corrections

Treat the user's correcting instructions as authoritative project feedback, not as one-off conversation context. Before starting related work, review this file and apply the relevant lessons. When the user corrects a behavior, design choice, workflow, or verification gap, identify the generalizable rule and record it in this file during the same task so it is not requested again. Preserve specific user wording when it expresses a durable preference, avoid recording secrets or temporary details, and mention the rule that was captured. Never overwrite an existing user change while recording feedback.

**Eyebrow and footer styling:** Eyebrow text should always be caps (uppercase for scripts with case; Kannada keeps normal letter spacing). Use one shared eyebrow treatment. The last full-width section of the ward page must meet the footer directly, with no blank gap. Ward section links should scroll smoothly beneath the sticky header, while respecting reduced-motion preferences.

**Reusable design-system documentation:** The design system should describe generic foundations, section patterns, and components, including form fields, buttons, cards, and their states. It should not mention specific pages except as example usage; do not organize its rules as individual page specifications.

**Button coverage:** Keep every button treatment documented and reusable, including light buttons and icon-only controls. Use shared styles for server-rendered and client-created buttons; page CSS should control placement rather than recreate a variant. Icon-only controls require a localized accessible name and documented sizing and interaction states.

**Hierarchical navigation:** Use shared breadcrumbs above the title on ward and comparison pages instead of a standalone Back to ward button. The ward breadcrumb includes both its citizen-facing number and localized name (for example, “Ward 23 Jogpalya”), never the composite route id. Ancestors are links; the current page is noninteractive. Keep the pattern documented in the design system.

**Approval before integration:** Once a requested change is implemented and verified, pause and ask the user once for approval to commit, merge, and push it. That single approval covers all three repository integration steps; do not ask for separate approvals.

## UI verification

After any UI change, use the `agent-browser` skill/CLI to inspect the live page at desktop and mobile widths. Before the first browser command, run `agent-browser skills get core` (or `agent-browser skills get core --full` when the full command reference is needed). Verify the actual rendered layout—not just the CSS or DOM—including column proportions, spacing, vertical alignment, control heights and widths, text wrapping, hover/focus states, and horizontal overflow. Compare reference-based changes against the reference site at the same viewport size before considering the work complete. Do not use the CUA browser surface for routine project UI verification when `agent-browser` is available.

**Explain registration prompts:** Place a short explanation beside registration calls to action stating what updates citizens receive and why they are useful. Keep it localized and consistent with the signed-in state.
