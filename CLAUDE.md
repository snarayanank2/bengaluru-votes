# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is being built

**GBA Elections Citizen Platform** (`bengaluruvotes.opencity.in`) — a pre-election platform giving Bengaluru citizens ward-level information for the GBA (corporator) ward elections. Citizens find their post-delimitation ward, read sourced candidate report cards, compare candidates, vote on the top-3 local issues, and get voting logistics. Fully bilingual (English / Kannada), 369 wards.

This serves a real election. Demo/fixture data is deliberately unmistakable as fake (`scripts/seed-dev.ts` — "Demo Party A", "(FICTIONAL)"); never introduce plausible-looking fake candidate or party data.

**Out of scope this release:** promise/accountability tracking, ward budgets, civic-issue officer directory, remote voting, candidate outreach tooling.

## The docs

- `docs/overview.md` — stakeholder summary. Start here for the *why*.
- `docs/prd.md` — authoritative product requirements: per-feature (§5), moderation (§6), permissions matrix (§7), NFRs (§12), locked decisions (§14), open questions (§17). **When a requirement is ambiguous, this wins.**
- `docs/architecture.md` — the technical design. Section numbers referenced throughout the source (`architecture §5`, `§9`, `§13`) are load-bearing; code comments point at them.
- `docs/information-architecture.md` — canonical URL/route map: every page and modal with its exact URL and access level.
- `docs/design-system.md`, `docs/gtm-plan.md` (campaign calendar the `jobs` container runs), `docs/project-plan.md`, `docs/project-dependencies.md`.

Source comments cite "Task NN" throughout — historical task briefs, mostly no longer in the repo. Treat them as provenance, not as files to find.

## Commands

```sh
npm run dev                 # astro dev
npm run build               # production build (see the SITE_ORIGIN warning below)
npm test                    # vitest, whole suite — requires DATABASE_URL
npm run typecheck           # astro check && tsc --noEmit
npm run migrate             # drizzle migrations, forward-only, idempotent
npm run translate -- --check  # bilingual staleness gate; no API calls, no key needed
npm run translate           # regenerate stale Kannada via Anthropic API (needs ANTHROPIC_API_KEY)
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
npm run build-pincode       # regenerates data/pincode-wards.json (still a placeholder)
```

### Running the app locally

```sh
docker compose -f deploy/compose.local.yml up --build -d   # http://localhost:4321
```

Builds from the working tree; runs migrations automatically; seeding is manual (commands in the file's header). The other two Compose files (`compose.staging.yml`, `compose.production.yml`) target the Droplet — they build the same Dockerfile but add TLS nginx, certbot and the jobs container, and expect real credentials, so they won't come up on a laptop.

### Tests need a database

Every DB-backed test reads `DATABASE_URL` and throws without it — the guard in each file points back here. Tests need a database **separate from the one the local app stack uses**, since they truncate and re-seed freely.

Start the local Postgres and create the two test databases once:

```sh
docker compose -f deploy/compose.local.yml up -d postgres
createdb -h localhost -p 5433 -U gba bv_test    # password: gba_local_dev
createdb -h localhost -p 5433 -U gba bv_e2e     # only needed for Playwright
```

Then, for any test run:

```sh
export DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test
npm test
```

Migrations run automatically — each DB-backed test file calls `migrate()` in its own `beforeAll`.

`vitest.config.ts` sets `fileParallelism: false` and `singleFork` on purpose: all DB-backed tests share one database, and parallel files race (a temporary DDL rule in `audit.test.ts` breaks other files' `INSERT ... RETURNING`; fixture ids collide). Don't re-enable parallelism.

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

**Public page HTML never varies by session.** nginx strips the `Cookie` header before proxying public routes, so the app cannot see a session there even if it wanted to. Logged-in users get the same cached anonymous markup; the three personalized elements (account control, register slot, already-voted state) are swapped client-side from one `GET /api/me`. The cache key ignores the query string entirely.

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

`t()` throws on a missing key unless *both* `import.meta.env.PROD` and `NODE_ENV=production` agree — so dev and tests surface missing translations loudly.

### Curator publishing and audit

Curator edits **go live immediately** — no approval gate. Every field carries a visible source, distinguishing official/affidavit data from curator-compiled context. `src/lib/publish.ts` owns the publish path (including manual-override vs source-change MT regeneration); `src/lib/audit.ts` owns the append-only log.

**`writeAudit` must be called with a transaction handle from an in-flight `db.transaction()`** so the audit row is atomic with the change it records. Migration `0001_audit_append_only.sql` enforces append-only at the database level.

### Contribution flows

Both citizen contributions — flagging misinformation and issue voting — show their buttons to anonymous users; tapping opens the Register/Login modal, and **the original action resumes in place** after auth. Flagging works across any ward; issue voting is restricted to the user's registered home ward.

Register/Login (fallback page `/login`), Flag, and Vote are **modals** that overlay without changing the URL. Every other screen is a distinct deep-linkable URL. Don't convert one into the other.

### Roles

Anonymous citizen (no account, most traffic, read-only) · Registered citizen · Data curator (**scoped to assigned wards/zone**) · Admin (city-wide). Permissions matrix: `docs/prd.md` §7.

## Gotchas that bite silently

- **`SITE_ORIGIN` / `EXTRA_ALLOWED_ORIGIN` are build-time.** `astro.config.mjs` resolves `site` and `security.allowedDomains` once, at build, against two hard-coded `*.opencity.in` hostnames. An image built without them for any other host serves every GET with a healthy 200 and **403s every POST** — nothing in `docker compose ps`, the healthcheck, or the logs indicates it. Any deploy verification must include a real POST.
- **`data/pincode-wards.json` is a 12-row placeholder.** Real Bengaluru pincodes report "out of coverage" until `npm run build-pincode` is run and the result committed. Not a bug in the lookup code.
- **`/data/gba.geojson` is not in `public/`.** Production serves it from the nginx static volume, populated by the `static-init` one-shot, which **does not re-run** on `up -d` once it has succeeded — stale CSS/JS after a deploy usually means it needs `docker compose run --rm static-init`.
- Unset vendor keys (`SENDGRID_*`, `TWILIO_*`, `GOOGLE_*`, `ANTHROPIC_API_KEY`, `RECAPTCHA_*`, `SENTRY_DSN`) each degrade to a documented no-op rather than an error. `deploy/runbook.md` has the exhaustive table with what each one's absence costs.

## Fixed decisions (don't relitigate without asking)

- **Auth:** one email / WhatsApp OTP mechanism for *all* roles. No passwords, no 2FA.
- **Curator publish:** trusted; immediate, no approval gate.
- **Bilingual:** EN at root, KN under `/kn/`, each with its own URL.
- **Deployment:** DigitalOcean — one BLR1 Droplet running staging + production Compose stacks. **There is no CI and no registry** (removed 2026-08-13): images are built on the box from a git checkout, and deploys are run by hand. Nothing fires on push, merge or release. `deploy/runbook.md` ("Deploying") is the procedure; `architecture.md` §14.3/§14.4 is the design.
- **Consequence worth holding onto:** `npm test`, `npm run typecheck` and `npm run translate -- --check` no longer gate anything. Run them before deploying — nothing else will.
- **Staging isolation:** `compose.staging.yml` must never join `back_prod`, and staging must keep `SENDS_DISABLED=true` with vendor keys omitted entirely. Those are two independent guards; keep both.

Open questions live in `docs/prd.md` §17 — check there before inventing an answer.
