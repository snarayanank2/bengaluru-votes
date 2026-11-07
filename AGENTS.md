# AGENTS.md

## What is being built

**GBA Elections Citizen Platform** (`bengaluruvotes.opencity.in`) — a platform giving Bengaluru citizens ward-level information for the GBA (corporator) ward elections. Citizens find their post-delimitation ward, find their polling booth, read sourced candidate report cards, compare candidates, vote on the top-3 local issues, get voting logistics, and — after the poll — see their ward's result. Fully bilingual (English / Kannada), 369 wards.

This serves a real election. Demo/fixture data is deliberately unmistakable as fake (`scripts/seed-dev.ts` — "Demo Party A", "(FICTIONAL)"); never introduce plausible-looking fake candidate or party data.

**Out of scope this release:** promise/accountability tracking, ward budgets, civic-issue officer directory, remote voting, candidate outreach tooling.

## The docs

- `docs/architecture.md` — the technical design: what runs where, caching, data model, API and auth, SEO, bilingual text, jobs, security, deployment. §15 lists the **dormant code slated for removal** (orphan pages, …); nothing in it is a feature. §16 is external dependencies and known gaps. Section numbers are load-bearing: code comments cite `architecture §N`.
- `docs/design-system.md` — visual language, neutrality rules, components and the UI completion checklist.
- `docs/gcp.md` — Google Cloud provisioning (Geocoding, Maps JS, Places, reCAPTCHA, GA4): what to create in which console and which env var it becomes. `deploy/runbook.md`'s env var table is the authority on what each variable does at runtime.

Open questions live in `docs/architecture.md` → Open questions (monitoring, retention period). Check there before inventing an answer.

Anything not stated in these docs or in the source is not written down. Do not invent a requirement to fill the gap — ask.

Source comments cite "Task NN" throughout — historical task briefs, mostly no longer in the repo. Treat them as provenance, not as files to find.

## Commands

```sh
npm run dev                 # astro dev
npm run build               # production build (see the SITE_ORIGIN warning below)
npm test                    # vitest, whole suite — requires DATABASE_URL
npm run typecheck           # astro check && tsc --noEmit; noUnusedLocals/noUnusedParameters are errors (remove dead code; in .astro frontmatter a local used only in a top-level `return` needs the documented `@ts-ignore`)
npm run migrate             # drizzle migrations, forward-only, idempotent
npm run translate -- --check  # bilingual staleness gate; no API calls, no key needed
npm run translate           # regenerate stale Kannada via the translation backend; routine translations are authored directly (below)
```

Single test file / single test:

```sh
npx vitest run tests/routes/ward.test.ts
npx vitest run tests/unit/staff-password.test.ts -t 'name of the case'
```

Seeds (order matters — `seed:dev` depends on wards existing):

```sh
npm run seed:wards          # the real 369 wards, from data/gba.geojson
npm run seed:dev            # fictional demo content; REFUSES under NODE_ENV=production
npm run seed:admin -- <email>   # idempotent; bootstraps the first admin (later ones: /admin/users)
```

### Running the app locally

```sh
docker compose -f deploy/compose.local.yml up --build -d   # http://localhost:4321
```

Builds from the working tree; runs migrations automatically; seeding is manual (commands in the file's header). The other Compose file (`compose.production.yml`) targets the VPS — it builds the same Dockerfile but add TLS nginx, certbot and the jobs container, and expect real credentials, so they won't come up on a laptop.

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
  -e SITE_ORIGIN=https://bengaluruvotes.opencity.in \
  app sh -c '
    export DATABASE_URL="${DATABASE_URL%/gba}/bv_test"
    unset ALLOW_INSECURE_LOCAL_RECAPTCHA \
      RECAPTCHA_SITE_KEY RECAPTCHA_SECRET_KEY MAPS_ENABLED GOOGLE_MAPS_BROWSER_KEY \
      GOOGLE_MAPS_MAP_ID GOOGLE_GEOCODING_API_KEY
    case "$DATABASE_URL" in */bv_test) npm test ;; *) echo "not bv_test; refusing"; exit 2 ;; esac'
```

For a single test file or test case, replace `npm test` with the relevant `npx vitest run ...` command from above. Migrations run automatically — each DB-backed test file calls `migrate()` in its own `beforeAll`. Never point this command at the app's `gba` database: it rewrites the app container's own `DATABASE_URL` to `bv_test` and refuses to run if that did not take, so no credential is typed on the command line.

The suite expects a clean environment, and the local image is not one. Every override above is there because a test fails without it:

- `SITE_ORIGIN` set to production: the candidate JSON-LD tests.
- The vendor keys from `deploy/.env.local` unset (reCAPTCHA, Maps, geocoding): the app service loads that file, and a reCAPTCHA site key adds a script tag to the ward page that the ward route test counts. They are unset as a group so a key added to that file later cannot leak into a run. `ALLOW_INSECURE_LOCAL_RECAPTCHA` is a local-only switch and goes with them.

If a run fails only in these areas, check the environment before the code. A variable added to `compose.local.yml` or `deploy/.env.local` belongs in the `unset` list too.

`vitest.config.ts` sets `fileParallelism: false` and `singleFork` on purpose: all DB-backed tests share one database, and parallel files race (fixture ids collide, and files truncate each other's tables). Don't re-enable parallelism.

### E2E (Playwright)

Three steps, in order — the first is not `npm run build`:

```sh
npm run build:e2e                                  # sets E2E_ALLOWED_HOST/_PORT for THIS build
DATABASE_URL=<...>/bv_e2e npm run seed:e2e         # migrates, seeds, writes tests/e2e/.fixtures.json
npm run test:e2e
```

E2E uses a dedicated `bv_e2e` database, never `bv_test`: `seed-e2e` picks wards by `ORDER BY id ASC LIMIT 3`, so leftover fixture rows from the vitest suite would make it nondeterministic.

## Architecture

Astro SSR monolith (TypeScript, `output: 'server'`, `@astrojs/node` standalone) + Postgres via Drizzle + an nginx micro-cache + a `jobs` cron container + an `extract-worker` container that reads queued affidavits, on single-VM Docker Compose. No other frameworks or services without asking.

### Route twins (bilingual)

Every screen is **one component in `src/features/pages/` taking a `lang: 'en' | 'kn'` prop**. Files under `src/pages/` are thin route shims that render it — `src/pages/<path>.astro` with `lang="en"`, `src/pages/kn/<path>.astro` with `lang="kn"`. English at root, Kannada under `/kn/`, hreflang-linked. See `src/features/pages/README.md`.

Adding a page means touching three files (feature component + two shims). API routes and `/media` are not localized.

**Status codes must live in the route shim, not the feature component.** Only page-level frontmatter can end a request with a custom status; a `Response` returned from a child component is ignored. That's why `src/pages/ward/[id].astro` does its own existence check before rendering `Ward.astro`. Staff screens do the same for a missing id, but render the staff-shell not-found page (`src/features/pages/StaffError.astro`) with a 404 status instead of the public one; the staff 403 page is rendered by the middleware through `next()` (architecture §4).

### `src/middleware.ts` — the single enforcement point

Session, CSRF, role authorization, CSP, and cache-safety all run here, before any route. Read its docstring before changing anything security-adjacent; it defines the route classes (public / `/curator`+`/admin`+`/transcribe` / `/api`) and their differing rules.

Two invariants worth stating outright:

- **It never calls `cookies.set`/`cookies.delete`, on any route.** That omission *is* the cache-safety guarantee (public GETs never set a cookie). A route test asserts it.
- **There is no per-ward scope.** Curators and admins are both city-wide, so the role check here is the whole answer for `/curator/*` and `/admin/*`; `canEditWard` and the `curator_scopes` table were removed (migration `0009`).

### The caching invariant

**Public page HTML never varies by session.** nginx strips the `Cookie` header before proxying public routes, so the app cannot see a session there even if it wanted to. Signed-in staff get the same cached anonymous markup; anonymous voting state comes from `GET /api/issue-votes` using an opaque HttpOnly receipt cookie. The cache key ignores the query string entirely.

Anything that would make a public page depend on the viewer breaks this. Put per-visitor state behind an uncached API instead.

### Islands

Client-side code is vanilla TypeScript in `src/islands/` — no UI framework. CSP is `script-src 'self' 'nonce-…'` with no `'unsafe-inline'`, built by the app (`src/lib/csp.ts`), not nginx.

`astro.config.mjs` sets `vite.build.assetsInlineLimit: 0` **because of this**: Astro silently inlines small hoisted scripts into the HTML with no nonce, and real browsers then block them — the islands never run, and the failure is invisible server-side. Don't raise that limit.

### Bilingual text — three separate layers

| Layer | Lives in | Kannada from |
|---|---|---|
| UI strings | `src/i18n/en.json` / `kn.json` | dev-time `npm run translate` |
| Editorial pages | `content/pages/en/*.md` / `kn/*.md` | dev-time `npm run translate` |
| Curator data | Postgres (`value_en` / `value_kn`) | at publish, runtime (`src/lib/translate-runtime.ts`) |

No layer translates at request time. Regeneration is unconditional — **hand-edits to generated Kannada are overwritten**; corrections belong in translation hints (frontmatter / `__hints`) or `src/i18n/glossary.json`. CI fails on a missing or stale `kn/` file or key (except the accepted `privacy.md` case).

For editorial or UI translation work, the coding agent authors the Kannada translation directly and preserve the generated `sourceHash` / `__hashes` metadata. Use `npm run translate -- --check` as the final staleness and hash gate. Do not depend on the translation backend (`scripts/translate.ts`: an Anthropic API key, or a local `claude` CLI) for routine translation work; it is a fallback for regeneration when explicitly needed.

`t()` throws on a missing key unless *both* `import.meta.env.PROD` and `NODE_ENV=production` agree — so dev and tests surface missing translations loudly.

### Curator publishing

Curator edits **go live immediately** — no approval gate. Every field carries a visible source, distinguishing official/affidavit data from curator-compiled context. Curators edit through the same structured inputs as transcribers, beside the stored affidavit: there is no free-text field editor. `src/lib/curator-fix.ts` parses and saves a fix (a flag at `/curator/queue/{id}`, or the candidate editor at `/curator/candidate/{id}`), and every publish of a field value or ward move carries a required `confirmPublish` tick, re-checked on the server. The candidate editor uses one bottom confirmation and one atomic save for changed fields and the ward; unchanged fields keep their review status. `src/lib/publish.ts` keeps what is not an affidavit field: creating a candidate, its status, and `decideTranslationStatus` (manual-override vs source-change MT regeneration).

**Field-specific flags use the eight fields in `FLAGGABLE_FIELD_KEYS`** (`src/lib/candidate-profile.ts`: the seven affidavit fields and the ward). Citizens can also report “Something else” (`candidate_other`); the queue cannot fix these directly and links to the candidate editor (architecture §7). Ward-targeted flags (`ward_field`, `ward_issue`) were removed on 2026-11-05 (migration `0018`); ward pages carry no flag control, and curators have no ward screens.

The curator routes are `/curator` (dashboard and search), `/curator/queue`, `/curator/candidate/{id}`, `/curator/matching` (the affidavits waiting for a candidate or ward) and `/curator/guide` (the onboarding page). They have no `/kn/` twin: the language is the signed-in user's saved one (`loadCuratorLang`).

**The audit log was removed on 2026-08-19** (tracker 147; `docs/architecture.md` §6, §7, §13) — no change history, no `/admin/audit`, and no restore action. Migration `0008_remove_audit_log.sql` drops the legacy table; `0001_audit_append_only.sql` remains only as immutable migration history.

### Affidavits: queue, extraction, matching

`candidate_affidavits` is the extraction queue (`src/lib/affidavit-queue.ts`): `queued → extracting → published | needs_matching | failed`. PDFs are stored in Postgres (`media`), not Google Cloud Storage. The `extract-worker` container (`jobs/extract-affidavits.ts`) claims rows under a lease and reads each with a Claude model, which also returns the candidate's name, ward, party and gender. A ward that resolves to exactly one ward creates and publishes the candidate with AI labels; anything else waits to be matched by a curator or an admin, at `/curator/matching` or `/admin/affidavits` (`confirmMatch`). **A failed extraction is never published as "not declared".**

`src/lib/affidavit-publish.ts` is the only writer of field values: `publishAffidavitFields` writes `candidate_fields.value_data` and the rendered `value_en` together, along with `checked_by`, `checked_at` and `confirmed_ai`. Curators now edit through the same structured inputs as transcribers, so nothing clears `value_data` any more. A candidate's ward is set by a curator or an admin (`moveCandidateWard`). A field nobody could read is `unreadable`, which the public pages show as "Could not be read from the affidavit", never as "Not declared".

Every model call is paid (about $0.20 per affidavit on Opus 5.5). The local `extract-worker` takes its Anthropic key from the shell that starts it and exits without one. Tests never call a model: `processOne` takes the extractor.

### Contribution flows

**Keep anonymous voting.** Issue voting requires no account: a visitor chooses exactly three issues in one ward, with one immutable ballot per browser receipt and results revealed after voting. Flagging candidate-field errors also requires no account and works across any ward. It opens directly in the existing modal, with CAPTCHA, browser/network limits and duplicate suppression. Reports are anonymous only: no submission is linked to an account, even a signed-in staff member's. Reports remain private and only curators publish corrections. Both actions show enabled buttons to anonymous users.

Flag is a **modal** that overlays without changing the URL. Staff sign in at `/login`; citizens never sign in. **Issue voting is inline** in the ward’s “What matters most in this ward” section: show the choices, selection count, submission, and feedback in place, without a popup. Keep anonymous voting and the exactly-three limit. After voting, show results immediately in place; also show them automatically on return visits with a valid receipt, without requiring a “Show results” click. In the voted state, replace the voting instructions with a results subtitle, show the receipt’s three choices, then show only the top five overall issues with votes. Keep the original instructions for visitors who have not voted. Every other screen is a distinct deep-linkable URL.

### Roles

Anonymous citizen (no account; all citizen traffic) · Transcriber · Data curator (**city-wide**, no ward or zone assignment) · Admin (city-wide). `roleEnum` in the schema (`transcriber | curator | admin`) is the authority on what exists: there are no citizen accounts. `src/middleware.ts` is the authority on what each can do. Removing someone's staff access at `/admin/users` deletes the account (or erases it when transcription history points at it). There is no written permissions matrix at present.

**Transcriber** has its own area, `/transcribe` (built 2026-10-13; `src/lib/transcribe.ts`). The middleware admits a transcriber or an admin to it; a curator gets 403. Beyond that it is authorized by assignment rather than by role: every read and write checks "does an open, unexpired assignment with this id belong to this caller", and anything else is a 404, for an admin too. There is one Start control and no list: do not add search, filters or any way to choose an affidavit. A hold lasts 10 minutes. **Admins** also own `/admin/affidavits`: bulk upload, the needs-matching list and the failed list. Curators work the same needs-matching list at `/curator/matching`; uploading, retrying and discarding are admin-only.

## Gotchas that bite silently

- **`SITE_ORIGIN` / `EXTRA_ALLOWED_ORIGIN` are build-time.** `astro.config.mjs` resolves `site` and `security.allowedDomains` once, at build, against two hard-coded `*.opencity.in` hostnames. An image built without them for any other host serves every GET with a healthy 200 and **403s every POST** — nothing in `docker compose ps`, the healthcheck, or the logs indicates it. Any deploy verification must include a real POST.
- **Address lookup has no fallback.** Pincode lookup was removed 2026-08-14 (`src/pages/api/ward-lookup.ts` header): the table behind it never advanced past a 12-row placeholder, so it told citizens to try something that could not work. Google geocoding is the *only* path from a typed address to a ward — exhausting `GEOCODE_DAILY_BUDGET` (default 2000/day, deliberately unchanged) or a Google outage takes that mode down, and the citizen sees an explicit "try again shortly" message. There is no browsable ward list to fall back to. The endpoint's **second input mode**, `{lat, lng}` from the home page's "use my current location" control, is the one path that survives such an outage: `lookupWardByPoint` goes straight to point-in-polygon, calling nothing and spending nothing. Don't route it through the geocoder or give it a cache row — the citizen's position is used once and dropped.
- **The ward map (Google Maps JS API, `src/islands/WardMap.ts`) needs three env vars to render at all**, not one: `MAPS_ENABLED` exactly `'true'` *and* a non-empty `GOOGLE_MAPS_BROWSER_KEY` *and* a non-empty `GOOGLE_MAPS_MAP_ID` (`src/lib/maps-config.ts`'s `mapsConfig().enabled`). Miss any one of the three and the map silently doesn't mount — `Ward.astro` renders the server-side fallback text instead, with no error anywhere. The same key also gates Places Autocomplete on the home-page ward-lookup form.
- **`/data/gba.geojson` is not in `public/`.** Production serves it from the nginx static volume, populated by the `static-init` one-shot, which **does not re-run** on `up -d` once it has succeeded — stale CSS/JS after a deploy usually means it needs `docker compose run --rm static-init`.
- Unset vendor keys (`GOOGLE_*`, `ANTHROPIC_API_KEY`, `RECAPTCHA_*`) each degrade to a documented no-op rather than an error. `deploy/runbook.md` has the exhaustive table with what each one's absence costs.

## Fixed decisions (don't relitigate without asking)

- **Auth:** only staff (admin, curator, transcriber) sign in; citizens are anonymous and never register. No 2FA, no sign-in links, no OTP, email or WhatsApp. **`/login` takes an active staff account's email plus that account's own password** (scrypt hash in `users.password_hash`; at least 16 characters; no `MASTER_PASSWORD` exists any more). Only an admin sets or replaces a password (`/admin/users`, `setStaffPassword`); there is no self-service reset, and an account with none cannot sign in. Setting one ends that person's sessions. Sessions are a 1-hour sliding idle timeout for every role (`src/lib/session.ts`). `npm run seed:admin -- <email>` bootstraps the first admin and prints a generated password once; `npm run set-password -- <email>` sets or resets one from the server (`STAFF_PASSWORD` env to choose it). Never write a real staff password in the repo; seeds print generated ones.
- **Curator publish:** trusted; immediate, no approval gate.
- **Bilingual:** EN at root, KN under `/kn/`, each with its own URL.
- **Deployment:** one Hostinger VPS (Mumbai, 4 vCPU / 16 GB) runs production Compose, from `/root/src/bengaluru-votes-production`. The staging site/stack was retired on 2026-09-18 and removed from the repo on 2026-10-13; production is the only environment. **There is no registry**: images are built on the box. CI/CD returned 2026-11-04: PRs must pass the `test` check, and every push to `main` deploys to production automatically (`.github/workflows/deploy.yml`, secrets from the GitHub `production` environment). “Deploy” means production; there is no staging step. `deploy/runbook.md` ("Deploying") is the procedure, and `.claude/skills/deploy-vps/SKILL.md` is a step-by-step version any agent can read; `architecture.md` §14.3/§14.4 is the design. Moved off the never-provisioned DigitalOcean Droplet on 2026-08-13.
- **SSH to the box:** `ssh bengaluruvotes-vps` (a host alias in each operator's `~/.ssh/config`, key-only, root; use it for any command on the VPS, never the bare hostname, whose host key a laptop will not have trusted). Production commands run from `/root/src/bengaluru-votes-production` (`deploy/runbook.md`).
- **Consequence worth holding onto:** a merge to `main` deploys production with no approval step. The `test` check (documented in architecture §12) is the only gate. A change that touches only docs (including `AGENTS.md`, `docs/`, `.claude/`, `deploy/runbook.md`) skips the gate and does not deploy; tests- or CI-only changes run the gate but do not deploy (`scripts/ci/changed-paths.mjs`; the runtime path list is in architecture §14.4).

## Agent sessions and git workflow

These rules apply to every coding agent, whichever tool runs it. Use normal sessions for implementation. Work in the primary checkout, one session at a time; two sessions must never edit the same checkout or branch at the same time.

Every new session must start its own instance of Docker Compose, configured to listen on a different host port from other active sessions. After starting it, present the resulting review URL to the user so they can inspect the changes directly.

**Do not use git worktrees.** A new worktree does not get the git-ignored `deploy/.env.local` copied in automatically, which breaks local development (the local Compose stack and the test commands read it). Work in the primary checkout on one descriptive branch per task (for example, `agent/<short-task-name>`), created from an up-to-date `main`. Keep changes focused, and report the branch, commit, tests, and limitations. Do not use `git reset --hard`, `git checkout --`, or broad cleanup commands that could discard another person's uncommitted work.

**Every change raises a PR.** Push the branch and open a pull request against `main`; never commit or push to `main` directly, however small the change. If GitHub is unavailable, keep committing on the local branch and open the PR once it is back.

**No agent session links in commits or PRs.** Commit messages, PR descriptions and PR comments must not link to an agent session (for example a `claude.ai/code/session_…` URL), even when a tool's default attribution adds one.

Return the primary checkout to `main` once a task's PR is raised. Changes reach `main` only by merging their PR, which deploys production (see Fixed decisions). If two sessions touch overlapping files, stop one or coordinate explicitly before either PR merges; never rely on concurrent edits resolving themselves.

Sessions may run tests and local servers independently, but use distinct ports, databases, and temporary files where applicable. Never point destructive test commands at another session's database or at the production database.

## Learning from corrections

Treat the user's correcting instructions as authoritative project feedback, not as one-off conversation context. Before starting related work, review this file and apply the relevant lessons. When the user corrects a behavior, design choice, workflow, or verification gap, identify the generalizable rule and record it in this file during the same task so it is not requested again. Preserve specific user wording when it expresses a durable preference, avoid recording secrets or temporary details, and mention the rule that was captured. Never overwrite an existing user change while recording feedback.

**Agent-neutral instructions:** `AGENTS.md` must work for any coding agent (Codex, Claude Code). Do not write tool-specific rules here; `CLAUDE.md` only imports this file.

**One source of truth:** State each rule once, in the file that owns it, and point to it from elsewhere instead of restating it (for example, production-verification policy lives in this file and the `ui-verifier` definition refers to it; the visual standard lives in `docs/design-system.md`).

**Eyebrow and footer styling:** Eyebrow text should always be caps (uppercase for scripts with case; Kannada keeps normal letter spacing). Use one shared eyebrow treatment. The last full-width section of the ward page must meet the footer directly, with no blank gap. Ward section links should scroll smoothly beneath the sticky header, while respecting reduced-motion preferences.

**User-facing documentation:** Keep public information pages, staff guides and help text simple. Use short sentences, familiar words and direct instructions. Remove AI-sounding phrases, promotional filler and unsupported promises. Preserve essential rules and keep English and Kannada in step. Keep the English homepage prose, live editorial pages and staff guides at a Flesch Reading Ease score above 65. The CI test and scoring method are documented in `tests/readability/README.md`. Preserve meaning and required disclosures; never add filler or remove needed instructions to raise a score. When editing guide wording, include `tests/routes/staff-guides.test.ts` in verification and update its wording assertions without weakening the rules they check.

**Reusable design-system documentation:** The design system should describe generic foundations, section patterns, and components, including form fields, buttons, cards, and their states. It should not mention specific pages except as example usage; do not organize its rules as individual page specifications.

**Button coverage:** Keep every button treatment documented and reusable, including light buttons and icon-only controls. Use shared styles for server-rendered and client-created buttons; page CSS should control placement rather than recreate a variant. Icon-only controls require a localized accessible name and documented sizing and interaction states.

**Hierarchical navigation:** Use shared breadcrumbs above the title on ward and comparison pages; they stay the primary hierarchical navigation. Candidate pages additionally carry a visible "Back to ward" text link (a link, never a button; owner decision 2026-11-06, replacing the earlier breadcrumbs-only rule), in the content area just under the identity band. The ward breadcrumb includes both its citizen-facing number and localized name (for example, “Ward 23 Jogpalya”), never the composite route id. Ancestors are links; the current page is noninteractive. Keep the pattern documented in the design system.

**Docs stay consistent with every change:** Fix every affected doc in the same change, without being asked: `docs/`, `AGENTS.md`, `deploy/runbook.md`, editorial pages in `content/pages/` (with their Kannada twin and hash metadata), and user-visible UI strings that describe the changed behaviour. Search for the removed or renamed thing across all of them before declaring the work done. Run the `docs-consistency` agent after removing or changing a feature.

**Approval before integration:** Once a requested change is implemented and verified, pause and ask the user once for approval to commit, push, and open its PR. That single approval covers all three steps; do not ask for separate approvals. Merging happens through the PR.

## UI verification

After any UI change, have the live rendered UI verified in a real browser with the `agent-browser` CLI, at desktop and mobile widths, before considering the work complete. Where the tool supports subagents, delegate this to the `ui-verifier` subagent (Claude Code: `.claude/agents/ui-verifier.md`). It holds the full procedure, checks the UI against `docs/design-system.md` (§11.1 is the baseline checklist) and reports bugs, design-system violations and design-system gaps separately. It never edits source or docs: fixing the UI or amending the design system is the caller's decision. Without subagents, follow that procedure yourself. Compare reference-based changes against the reference site at the same viewport size. Prefer `agent-browser` over a tool's built-in browser for routine project UI verification.

**Verifying against production:** UI verification may run against `bengaluruvotes.opencity.in`, not only a local stack. On production the agent may submit anonymous flags, sign in with test staff accounts, fix or reject flags, and cast an issue vote, but only on records marked fictional (the "(FICTIONAL)" demo candidates) and only in ward 1001, the designated test ward. It must never change a real candidate, a real ward's data, or a real staff account, and must never try to circumvent the one-ballot-per-browser rule. Report every change made (record, field, old and new value) so it can be reversed. Test staff accounts are listed in the "Test Accounts" sheet (https://docs.google.com/spreadsheets/d/18wXM6IgKERWQdOLfRpJ42lYtyHQsJtdk8jYilmmWTRA/edit?usp=sharing); the sheet holds the credentials, so never copy a password into this file, a commit, a PR, a screenshot or a report. Production test activity is real traffic: it lands in the curator queue, flag counts, vote tallies for ward 1001 and Google Analytics, and public pages may lag a publish by a few minutes because of the nginx cache.

**Transcriber screens are desktop only:** Transcribing needs the affidavit scan and the form side by side, so it "will be difficult to transcribe on mobile". Do not design, build or browser-test a mobile layout for `/transcribe`; verify those screens with `agent-browser` at a desktop viewport alone. Public pages still get both widths.

**Candidate-data operation:** Siva bulk-loads affidavits as soon as the first ones are available online — do not wait for a final notification, final candidate list or complete set — and AI extraction and transcription proceed on ready records while loading continues. Order of work: bulk loading, AI extraction (one confidence percentage per affidavit), transcriber review, then curators resolving user flags and matching affidavits waiting for a candidate or ward. The transcriber queue serves missing data first, low AI confidence next, then the rest. A flag enters the curator queue and the curator either rejects it or fixes the data. Curators do not oversee routine transcription or unflagged cases, and do not upload, retry or discard affidavits (admin-only). Reconcile rejected/withdrawn candidates against later official lists. When presenting the operation, keep AI and transcription budgets separate from the flag-curation rota through election day, and distinguish planning assumptions from measured results.

**Staff entry rules and escalation (2026-11-06):** the staff guides (`src/components/FieldEntryRules.astro`, `src/features/pages/{curator,transcribe}/Guide.astro`) state these once; keep them in step with any change. Names and parties are entered exactly as printed on the affidavit, in English letters, titles and initials as printed, the party's full name as printed, `Independent` for independents. Assets are whole rupees, and nil assets are `Not declared`. A pending criminal case is one the affidavit's own criminal-cases section lists as pending; nobody interprets beyond it. A field saved as *Cannot read* is fixed later by any curator in the candidate editor, checking the affidavit (there is no list of such fields yet, so a curator finds the candidate by name). Curators do not use the AI confidence figure; it only orders the transcriber queue. A corrected sent-back match goes live at once and is not re-queued to transcribers. Wards are the current post-delimitation wards (corporation, number, name); an affidavit naming an old ward that cannot be mapped is left for matching, never guessed. There is no in-app channel to the admin: curators message the admin directly, quoting candidate name and ward, and no contact detail is printed in the guides. Citizen-supplied source links are opened only if the site is recognised, with no credentials entered and no files downloaded. The transcriber's report button stays labelled "Send to an admin". The flag verb is *Reject* everywhere, never "dismiss".

**Candidate identity and photos:** Use the report-card full-name and party fields, including their Kannada translations, everywhere a candidate identity is displayed or searched. Do not add separate Kannada name/party inputs. The candidate editor has no election-status or affidavit-upload sections, for either curators or admins. Reject direct status/upload submissions there. Use one bottom confirmation and Save and publish action for changed report-card fields and ward changes together; never mark unchanged fields as checked. Do not offer candidate photo uploads: photos are not expected. Preserve existing translations when migrating legacy data.

**Anonymous candidate reports (2026-11-02):** Keep reporting free of login and contact requirements. Use layered CAPTCHA, atomic rate limits, duplicate suppression and per-submission spam controls. Counts are submissions, not verified people or evidence. Never publish automatically or close legitimate reports merely because another submission on the same field is spam. Reporters receive confirmation only; reports are never linked to an account (2026-11-04). Abuse metadata cleanup runs daily (`jobs/flag-cleanup.ts`). See `docs/architecture.md` §6 (Candidate flags), §7 (Anonymous candidate reports), §13 (accepted limitations) and `deploy/runbook.md`.

**Transcriber confirmation and timeout (2026-11-02):** Use one “I checked this against the affidavit” checkbox for the entire form. Require it on the server before publishing all fields together. Each assignment lasts 10 minutes, then becomes available automatically; expired submissions cannot publish.

**No provisional candidate-list notice (2026-11-02):** Do not show “Provisional — the candidate list may still change until withdrawals close.” or its Kannada translation on any public page, regardless of the withdrawals-closed setting.

**Citizen privacy scope (2026-11-02):** Citizen registration and email/WhatsApp subscriptions are permanently dropped; login is staff-only. No real citizen accounts or contact details were collected. Google Analytics, Maps/address lookup and reCAPTCHA remain; Sentry is not used. Public policies must describe anonymous submissions, technical identifiers and logs accurately rather than claim no citizen data is processed. Use Oorvani Foundation as operator and sivaramakrishnan.n@oorvani.in for privacy and terms enquiries. Publish plain-language English and Kannada policies without draft placeholders; never invent retention guarantees.
