# Hostinger VPS Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move production and staging off the never-provisioned DigitalOcean Droplet onto the existing Hostinger VPS, and make the repo describe that deployment truthfully.

**Architecture:** A provider swap, not a re-architecture. The runtime topology (shared nginx terminating TLS for two hostnames, two Compose projects sharing only `gba_front`, build-on-box with no registry, manual deploys, forward-only migrations) is unchanged. What changes: the box and its provider-specific ops, the staging hostname, a per-environment checkout layout with an explicit branch policy, and the deploy script becoming committed repo tooling.

**Tech Stack:** Docker Compose, nginx, certbot, Postgres 16, Astro SSR (Node standalone adapter), bash, Drizzle migrations.

**Spec:** `docs/superpowers/specs/2026-08-13-hostinger-deployment-design.md`

## Global Constraints

- Production hostname: `bengaluruvotes.opencity.in` — **unchanged**.
- Staging hostname: `staging-bengaluruvotes.opencity.in` (flat name, NOT a `staging.` subdomain). Replaces `staging.bengaluruvotes.opencity.in` everywhere.
- Box: Hostinger VPS, Mumbai, 4 vCPU / 16 GB / 193 GB, IPv4 `76.13.244.198`, IPv6 `2a02:4780:12:4759::1`.
- Deploys run as `root`. Checkouts live at `/root/src/bengaluru-votes-staging` (tracks `origin/main`) and `/root/src/bengaluru-votes-production` (detached on an annotated tag `vYYYY.MM.DD`).
- Env files live at `/etc/bengaluru-votes/.env.staging` and `/etc/bengaluru-votes/.env.production`, mode 600, outside both checkouts.
- Compose project names are pinned in the compose files: `bengaluru-votes-production`, `bengaluru-votes-staging` (matching the existing `bengaluru-votes-local`).
- Image tags: `bengaluru-votes:latest` / `:previous` (production), `bengaluru-votes-staging:latest` / `:previous` (staging). Never shared between environments.
- `SITE_ORIGIN` and `EXTRA_ALLOWED_ORIGIN` are **build-time**. An image built without the right one serves every GET a healthy 200 and 403s every POST, invisibly. Every deploy verification must include a real POST.
- Backups (`RESTIC_*`, `AWS_*`, `HEALTHCHECKS_URL`) and external monitoring are **deferred and unresolved** — documented as gaps, never quietly re-pointed at a substitute.
- Vendor keys (SendGrid, Twilio, Google, Anthropic, reCAPTCHA, Sentry) remain unavailable. Each already degrades to a documented no-op; do not add fallbacks.
- Design-history documents under `docs/superpowers/specs/` keep their DigitalOcean references. They are history.

---

### Task 1: Pin Compose project names

Compose derives a project name from the directory containing the first compose file — `deploy/` in **both** checkouts — so the production and staging stacks would collide in a single project called `deploy`: each `up -d` would treat the other's containers as orphans, and the project-prefixed volume names (`deploy_pg_data_prod`, `deploy_pg_data_staging`) would live in one namespace. `deploy/compose.local.yml:46` already pins `name: bengaluru-votes-local`; the other two files never got it.

**Files:**
- Modify: `deploy/compose.production.yml` (add top-level `name:`)
- Modify: `deploy/compose.staging.yml` (add top-level `name:`)

**Interfaces:**
- Produces: project names `bengaluru-votes-production` and `bengaluru-votes-staging`, relied on by Task 3's deploy script and Task 5's runbook. Volumes resolve as `bengaluru-votes-production_pg_data_prod`, `bengaluru-votes-staging_pg_data_staging`, etc. These names must never change afterwards — renaming a project silently points Postgres at a new, empty volume.

- [ ] **Step 1: Add the project name to the production compose file**

In `deploy/compose.production.yml`, immediately before the `services:` key (after the file's header comment block), insert:

```yaml
# Compose project name, pinned rather than inferred. Without this, Compose
# derives the project from the directory holding this file — `deploy/` —
# which is identical in the staging checkout (architecture §14.3's
# per-environment trees), so both stacks would share one project namespace
# and each `up -d` would treat the other's containers as orphans. It also
# fixes the volume prefix: `bengaluru-votes-production_pg_data_prod`.
# NEVER change this value on a live box — a new project name means a new,
# empty pg_data volume, which reads as "the database vanished".
name: bengaluru-votes-production

```

- [ ] **Step 2: Add the project name to the staging compose file**

In `deploy/compose.staging.yml`, immediately before `services:`, insert:

```yaml
# Pinned for the same reason as compose.production.yml's — see that file's
# comment. Both compose files live in a `deploy/` directory, one per
# checkout, so an inferred project name would be `deploy` for both.
# NEVER change this value on a live box.
name: bengaluru-votes-staging

```

- [ ] **Step 3: Verify both files parse and report the intended project name**

Run:

```sh
docker compose -f deploy/compose.production.yml config --format json | head -c 60
docker compose -f deploy/compose.staging.yml config --format json | head -c 60
```

Expected: each prints `{"name": "bengaluru-votes-production"` / `{"name": "bengaluru-votes-staging"` respectively. If `docker compose config` errors on the staging file because `gba_front` does not exist locally, that is expected — `config` does not require the external network; only `up` does. If it does error, re-run with `--no-interpolate` and confirm the `name:` key is present.

- [ ] **Step 4: Commit**

```sh
git add deploy/compose.production.yml deploy/compose.staging.yml
git commit -m "fix(deploy): pin the Compose project name for each stack

Both compose files sit in a directory called deploy/, one per
per-environment checkout, so Compose would infer the same project
name for production and staging and merge them into one namespace.
compose.local.yml already pinned its own; these two never did."
```

---

### Task 2: Staging hostname

`staging.bengaluruvotes.opencity.in` → `staging-bengaluruvotes.opencity.in` everywhere it is a live configuration value or a comment describing one.

**Files:**
- Modify: `astro.config.mjs:60`
- Modify: `deploy/compose.staging.yml` (the `SITE_ORIGIN` default, and the header comment if it names the host)
- Modify: `deploy/nginx/nginx.conf:5`
- Modify: `deploy/nginx/conf.d/site.conf:9,203,235,237,238`
- Modify: `tests/load/k6-election-day.js:99`

**Interfaces:**
- Produces: the staging origin `https://staging-bengaluruvotes.opencity.in`, consumed by Task 3's deploy script (as the staging `SITE_ORIGIN` build arg and verification target) and by Task 5's runbook (certbot, DNS, k6).

- [ ] **Step 1: Prove the old hostname is present where expected**

Run:

```sh
grep -rn "staging\.bengaluruvotes\.opencity\.in" \
  astro.config.mjs deploy/ tests/ docs/ CLAUDE.md
```

Expected: matches in `astro.config.mjs`, `deploy/compose.staging.yml`, `deploy/nginx/nginx.conf`, `deploy/nginx/conf.d/site.conf`, `deploy/runbook.md`, `docs/architecture.md`, `tests/load/k6-election-day.js`. `deploy/runbook.md` and `docs/architecture.md` are rewritten wholesale in Tasks 4 and 5 — leave them alone here.

- [ ] **Step 2: Update `astro.config.mjs`**

Change line 60 from:

```js
      { hostname: 'staging.bengaluruvotes.opencity.in', protocol: 'https' },
```

to:

```js
      { hostname: 'staging-bengaluruvotes.opencity.in', protocol: 'https' },
```

Then update the `allowedDomains` comment above it: the phrase "production + staging on one Droplet, both behind the shared nginx" becomes "production + staging on one VPS, both behind the shared nginx".

Also rewrite the `EXTRA_ALLOWED_ORIGIN` comment (lines 76–88). It currently reads "One escape hatch for a TEMPORARY deployment on a hostname that isn't either of the two above — currently the interim Hostinger VPS standing in until the DigitalOcean Droplet of §14 is provisioned." Replace that first sentence with:

```js
      // One escape hatch for a TEMPORARY deployment on a hostname that
      // isn't either of the two above — a preview box, or the VPS's own
      // `*.hstgr.cloud` name before DNS is cut over. Not used by a normal
      // staging or production build (architecture §14).
```

Leave the rest of that comment (the build-time warning, the distinction from `E2E_ALLOWED_HOST`, the "set to a full origin" instruction) exactly as it is — it is still accurate and load-bearing.

- [ ] **Step 3: Update `deploy/compose.staging.yml`**

Change the `SITE_ORIGIN` default:

```yaml
        SITE_ORIGIN: ${SITE_ORIGIN:-https://staging-bengaluruvotes.opencity.in}
```

- [ ] **Step 4: Update the nginx config**

In `deploy/nginx/nginx.conf:5`, the header comment's `staging.bengaluruvotes.opencity.in` becomes `staging-bengaluruvotes.opencity.in`.

In `deploy/nginx/conf.d/site.conf`, change all five occurrences:

- line 9 (header comment, "3. staging — …")
- line 203 (`server_name bengaluruvotes.opencity.in staging.bengaluruvotes.opencity.in;` — the port-80 redirect/ACME block)
- line 235 (`server_name` of the staging 443 block)
- lines 237–238 (`ssl_certificate` and `ssl_certificate_key` paths, `/etc/letsencrypt/live/<host>/…`)

The cert paths matter operationally: certbot writes to `/etc/letsencrypt/live/<the -d argument>/`, so these must match the hostname Task 6 passes to `certbot certonly` exactly.

- [ ] **Step 5: Update the k6 default target**

In `tests/load/k6-election-day.js:99`:

```js
const BASE_URL = (__ENV.BASE_URL || 'https://staging-bengaluruvotes.opencity.in').replace(/\/$/, '');
```

- [ ] **Step 6: Verify no stray references remain outside the two docs rewritten later**

Run:

```sh
grep -rn "staging\.bengaluruvotes\.opencity\.in" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=worktrees \
  --exclude-dir=specs --exclude-dir=plans
```

Expected: matches ONLY in `deploy/runbook.md` and `docs/architecture.md`, both rewritten in Tasks 4 and 5. Everything else must be clean. (`docs/superpowers/specs/` and `plans/` are excluded throughout this plan: they are dated design documents and quote the old names on purpose.)

- [ ] **Step 7: Verify nginx still parses**

Run:

```sh
docker run --rm \
  -v "$PWD/deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/deploy/nginx/conf.d:/etc/nginx/conf.d:ro" \
  -v "$PWD/deploy/nginx/snippets:/etc/nginx/snippets:ro" \
  nginx:stable nginx -t
```

Expected: this FAILS with `cannot load certificate "/etc/letsencrypt/live/…"` and/or a missing `/etc/nginx/staging.htpasswd`, because neither exists in a bare container. That is the correct outcome. What you are checking is that it does **not** fail with a *syntax* error (`unexpected "}"`, `unknown directive`, `invalid number of arguments`) and that the certificate path it names is the new hostname. If it reports a syntax error, fix it before continuing.

- [ ] **Step 8: Typecheck and run the suite**

Run:

```sh
npm run typecheck
DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npm test
```

Expected: both pass. `astro.config.mjs` is the only source file touched, and only its `allowedDomains` string and comments changed; a failure here means something unintended was edited.

- [ ] **Step 9: Commit**

```sh
git add astro.config.mjs deploy/compose.staging.yml deploy/nginx tests/load/k6-election-day.js
git commit -m "config: move staging to staging-bengaluruvotes.opencity.in

A flat hostname rather than a staging. subdomain. Nothing in the
design depends on the difference — two certs and two server blocks
either way — but the cert paths in site.conf must match what
certbot is invoked with, so they move together."
```

---

### Task 3: `deploy/deploy.sh`

Replace the single-environment interim script with committed two-environment tooling. The verification discipline (mandatory POST, unconditional `static-init` re-run) carries over unchanged — it is the part that has already caught a real silent failure.

**Files:**
- Create: `deploy/deploy.sh` (mode 755)
- Delete: `.claude/skills/deploy-vps/deploy.sh`
- Modify: `.claude/skills/deploy-vps/SKILL.md` (shrink to a pointer + failure-mode table)

**Interfaces:**
- Consumes: the project names from Task 1, the staging origin from Task 2.
- Produces: the deploy commands `deploy/deploy.sh staging`, `deploy/deploy.sh production <tag>`, `deploy/deploy.sh <env> --rollback`, referenced by Tasks 4, 5, and 9.

- [ ] **Step 1: Write `deploy/deploy.sh`**

Create the file with exactly this content:

```bash
#!/usr/bin/env bash
#
# Deploy bengaluru-votes to the Hostinger VPS (architecture.md §14.4).
#
#   deploy/deploy.sh staging                  # build+deploy origin/main
#   deploy/deploy.sh production v2026.08.14   # build+deploy that annotated tag
#   deploy/deploy.sh staging    --rollback    # retag :previous and restart
#   deploy/deploy.sh production --rollback
#
# Runs entirely over SSH against the box; nothing is built locally. The
# environment's checkout on the box is what gets built, so the ref this
# script lands that tree on IS the version that ships (§14.3).
#
# Env overrides:
#   VPS_SSH_ALIAS   ssh host/alias to deploy to        (default: vps)
#   STAGING_USER    staging basic-auth username        (needed to verify staging)
#   STAGING_PASS    staging basic-auth password
#
# THE ONE THING THAT BREAKS SILENTLY: astro.config.mjs resolves `site` and
# `security.allowedDomains` at BUILD time. An image built without the right
# SITE_ORIGIN serves every GET a healthy 200 and 403s every POST — ward
# lookup, login, votes, flags all dead — and nothing in `docker compose ps`,
# the healthcheck, or the app logs says so. That is why verify() below does a
# real POST and treats 403 as a hard failure. A deploy checked with GET alone
# is not verified.

set -euo pipefail

SSH_ALIAS=${VPS_SSH_ALIAS:-vps}

say()   { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail()  { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }
usage() {
  sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

remote() { ssh "$SSH_ALIAS" "$@"; }

# --- Argument parsing ------------------------------------------------------

ENV_NAME=${1:-}
ARG2=${2:-}

case "$ENV_NAME" in
  staging)
    TREE=/root/src/bengaluru-votes-staging
    COMPOSE_FILE=deploy/compose.staging.yml
    PROJECT=bengaluru-votes-staging
    APP_SERVICE=app-staging
    IMAGE=bengaluru-votes-staging:latest
    PREV=bengaluru-votes-staging:previous
    ORIGIN=https://staging-bengaluruvotes.opencity.in
    ENV_VAR="STAGING_ENV_FILE=/etc/bengaluru-votes/.env.staging"
    HAS_STATIC_INIT=no
    ;;
  production)
    TREE=/root/src/bengaluru-votes-production
    COMPOSE_FILE=deploy/compose.production.yml
    PROJECT=bengaluru-votes-production
    APP_SERVICE=app
    IMAGE=bengaluru-votes:latest
    PREV=bengaluru-votes:previous
    ORIGIN=https://bengaluruvotes.opencity.in
    ENV_VAR="PROD_ENV_FILE=/etc/bengaluru-votes/.env.production"
    HAS_STATIC_INIT=yes
    ;;
  *)
    usage
    ;;
esac

# Every remote compose invocation: the env-file indirection must be exported
# inline. `ssh host 'cmd'` is a non-interactive shell and does NOT source
# ~/.bashrc, so a profile export would silently not apply and Compose would
# fall back to ./.env.<env>, which does not exist in the checkout.
COMPOSE="export $ENV_VAR; cd $TREE && docker compose -p $PROJECT -f $COMPOSE_FILE"

# --- Verification ----------------------------------------------------------

verify() {
  local code asset curl_auth=()

  if [ "$ENV_NAME" = staging ]; then
    [ -n "${STAGING_USER:-}" ] && [ -n "${STAGING_PASS:-}" ] \
      || fail "staging verification needs STAGING_USER and STAGING_PASS (nginx basic auth)"
    curl_auth=(-u "$STAGING_USER:$STAGING_PASS")
  fi

  say "Verifying $ORIGIN"

  for path in /healthz / /kn/; do
    code=$(curl -fsS "${curl_auth[@]}" -o /dev/null -w '%{http_code}' "$ORIGIN$path" || true)
    [ "$code" = 401 ] && fail "GET $path returned 401 — wrong STAGING_USER/STAGING_PASS"
    [ "$code" = 200 ] || fail "GET $path returned $code"
    printf '  GET %-10s 200\n' "$path"
  done

  # Catches a stale static_assets volume: the HTML references a hashed asset
  # filename that exists only if static-init copied THIS image's build output.
  asset=$(curl -fsS "${curl_auth[@]}" "$ORIGIN/" | grep -o '/_astro/[^"]*\.js' | head -1 || true)
  [ -n "$asset" ] || fail "no /_astro/ asset referenced in the homepage HTML"
  code=$(curl -fsS "${curl_auth[@]}" -o /dev/null -w '%{http_code}' "$ORIGIN$asset" || true)
  [ "$code" = 200 ] || fail "asset $asset returned $code — static-init did not re-run"
  echo "  $asset  200"

  # The load-bearing check. Status only, never the body: an out-of-coverage
  # pincode is still a valid 200, so this keeps working once
  # data/pincode-wards.json holds real pincodes.
  code=$(curl -fsS "${curl_auth[@]}" -o /dev/null -w '%{http_code}' \
    -X POST "$ORIGIN/api/ward-lookup" \
    -H 'content-type: application/json' \
    -H "Origin: $ORIGIN" \
    -d '{"pincode":"560001"}' || true)
  if [ "$code" = 403 ]; then
    fail "POST /api/ward-lookup returned 403 — image built WITHOUT the right
SITE_ORIGIN. Every form on the site is broken. Rebuild with this script."
  fi
  [ "$code" = 200 ] || fail "POST /api/ward-lookup returned $code"
  echo "  POST ward-lookup    200 (not 403 — origin baked in correctly)"

  say "$ENV_NAME verified"
}

restart_and_verify() {
  say "Restarting the $ENV_NAME stack"
  remote "$COMPOSE up -d" 2>&1 | tail -5

  # ALWAYS, unconditionally: `up -d` does NOT re-run a one-shot service that
  # has already completed successfully, so without this the new image's
  # hashed /_astro/* assets never reach the volume nginx serves and every
  # page 404s its own CSS and JS. Staging has no static-init (it proxies
  # everything to Node), hence the guard.
  if [ "$HAS_STATIC_INIT" = yes ]; then
    say "Re-populating static assets"
    remote "$COMPOSE run --rm static-init"
  fi

  verify
}

# --- Rollback --------------------------------------------------------------

if [ "$ARG2" = --rollback ]; then
  say "Rolling back $ENV_NAME to $PREV"
  remote "docker image inspect $PREV >/dev/null 2>&1" \
    || fail "no $PREV image on the box — nothing to roll back to"
  remote "docker image tag $PREV $IMAGE"
  # No migration step on this path, ever: migrations are forward-only and
  # backward-compatible (§14.7), so the previous image runs fine against the
  # current schema and a rollback is never a schema operation.
  restart_and_verify
  exit 0
fi

# --- Deploy ----------------------------------------------------------------

if [ "$ENV_NAME" = production ]; then
  REF=$ARG2
  [ -n "$REF" ] || fail "production deploys take an explicit tag: deploy/deploy.sh production v2026.08.14"
else
  REF=${ARG2:-main}
fi

say "Preflight"
remote true || fail "cannot ssh to '$SSH_ALIAS' (override with VPS_SSH_ALIAS)"
remote "[ -d $TREE/.git ]" || fail "$TREE is not a git checkout — the box was never provisioned"
remote "[ -f ${ENV_VAR#*=} ]" || fail "${ENV_VAR#*=} is missing — see deploy/runbook.md"

# A dirty checkout means somebody edited that box directly. Stop and let a
# human decide; clobbering their work automatically is never the right call.
if ! remote "cd $TREE && git diff --quiet && git diff --cached --quiet"; then
  remote "cd $TREE && git status --short"
  fail "the checkout at $TREE has local modifications (above). Reconcile them by hand."
fi
echo "  ssh ok, checkout clean, env file present"

# Before the build, because the build overwrites :latest. There is no
# registry (§14.3), so this image on this box IS the rollback story.
say "Tagging the running image as $PREV"
remote "docker image inspect $IMAGE >/dev/null 2>&1 && docker image tag $IMAGE $PREV || echo '  (no current image — first deploy, skipping)'"

say "Updating $TREE to $REF"
if [ "$ENV_NAME" = production ]; then
  # Detached on an immutable tag: `git log -1` in this tree is then an honest
  # answer to "what is production running".
  remote "cd $TREE && git fetch --prune --tags origin && git checkout '$REF' && git log --oneline -1"
else
  remote "cd $TREE && git fetch --prune origin && git checkout -B '$REF' 'origin/$REF' && git log --oneline -1"
fi

say "Building $IMAGE"
remote "$COMPOSE build" 2>&1 | tail -5

# Forward-only and idempotent, so this is safe when there is nothing new. A
# failure here aborts the deploy BEFORE any container restarts — the running
# version continues against the unchanged schema.
say "Running migrations"
remote "$COMPOSE run --rm $APP_SERVICE npm run migrate" 2>&1 | grep -v '^npm notice' | tail -5

restart_and_verify
```

- [ ] **Step 2: Make it executable and syntax-check it**

Run:

```sh
chmod 755 deploy/deploy.sh
bash -n deploy/deploy.sh
```

Expected: `bash -n` prints nothing and exits 0.

- [ ] **Step 3: Verify argument validation without touching the box**

Run each and check the outcome:

```sh
deploy/deploy.sh            ; echo "exit=$?"   # expect usage text, exit=2
deploy/deploy.sh nonsense   ; echo "exit=$?"   # expect usage text, exit=2
VPS_SSH_ALIAS=definitely-not-a-host deploy/deploy.sh production
```

Expected: the first two print the usage block (the `#` comment lines 3–10, with the leading `# ` stripped) and exit 2. The third must fail with `production deploys take an explicit tag` — argument validation happens before any SSH, so an unreachable host is irrelevant at that point.

```sh
VPS_SSH_ALIAS=definitely-not-a-host deploy/deploy.sh production v0.0.0 ; echo "exit=$?"
```

Expected: fails at Preflight with `cannot ssh to 'definitely-not-a-host'`, exit 1. This proves the SSH guard fires before anything mutates.

- [ ] **Step 4: Delete the interim script**

```sh
git rm .claude/skills/deploy-vps/deploy.sh
```

- [ ] **Step 5: Rewrite the skill as a pointer**

Replace the entire contents of `.claude/skills/deploy-vps/SKILL.md` with:

```markdown
---
name: deploy-vps
description: Use when deploying, updating, redeploying, or rolling back bengaluru-votes on the Hostinger VPS that runs both staging (staging-bengaluruvotes.opencity.in) and production (bengaluruvotes.opencity.in). Also use when either host serves stale CSS/JS after a deploy, 403s form submissions, or the stack will not come up.
---

# Deploying to the VPS

The deploy tool is `deploy/deploy.sh`, committed in the repo — not in this
skill. It does the whole sequence and verifies it:

```sh
deploy/deploy.sh staging                  # build+deploy origin/main
deploy/deploy.sh production v2026.08.14   # build+deploy that annotated tag
deploy/deploy.sh <env> --rollback         # retag :previous, restart, re-verify
```

Read `deploy/runbook.md` ("Deploying") for the procedure around it — what to
run before you deploy, the staging-then-production discipline, and the
release-tagging step. `docs/architecture.md` §14 is the design.

## The one thing that breaks silently

`astro.config.mjs` resolves `site` and `security.allowedDomains` once, at
**build** time. An image built with the wrong `SITE_ORIGIN` still serves
every page a perfectly healthy 200 — and rejects every POST with 403. Ward
lookup, login, issue votes and flags all break, and **nothing in
`docker compose ps`, the healthcheck, or the app logs indicates it.**

That is why `deploy.sh`'s verification does a real `POST /api/ward-lookup`
and treats 403 as a hard failure. A deploy that only checks `GET /` is not
verified. This holds for both environments.

## Quick reference

| Symptom | Cause | Fix |
|---|---|---|
| Forms 403, pages fine | Image built with the wrong `SITE_ORIGIN` | Redeploy via `deploy.sh` — it passes the right one per environment |
| New CSS/JS 404s, or old styling persists | `static-init` did not re-run — `up -d` skips a one-shot that already succeeded | `deploy.sh` always re-runs it; by hand it is `docker compose -p bengaluru-votes-production -f deploy/compose.production.yml run --rm static-init` |
| App container restart-loops | Usually a migration that has not run | `docker compose -p <project> -f <file> run --rm <app-service> npm run migrate` |
| Staging verification 401s | `STAGING_USER`/`STAGING_PASS` unset or wrong (nginx basic auth) | Export both; credentials are in the box's htpasswd, generated per `deploy/runbook.md` |
| `git pull`/checkout refuses | The checkout has local modifications | Reconcile by hand — never `--force` blindly, someone edited that box for a reason |
| Staging stack will not come up | Production stack is down, so `gba_front` does not exist | Bring production up first; staging joins that network as external |
| Real Bengaluru pincodes say "out of coverage" | `data/pincode-wards.json` is still a 12-row placeholder | Not a deploy bug — run `npm run build-pincode` and commit the result |

## Not automated, deliberately

- **Provisioning.** First certs, env files, the htpasswd, seeding: `deploy/runbook.md`.
- **Release tagging.** Deciding a commit is production-worthy is a human step (`git tag -a vYYYY.MM.DD`), done after staging verifies.
- **Secret rotation.** `/etc/bengaluru-votes/.env.*` holds the only copy of each environment's `SESSION_SECRET` and Postgres password.
```

- [ ] **Step 6: Commit**

```sh
git add deploy/deploy.sh .claude/skills/deploy-vps/SKILL.md
git commit -m "feat(deploy): commit a two-environment deploy script

deploy/deploy.sh replaces the interim single-environment script that
lived in .claude/skills/. It is ordinary operational tooling and
belongs in the repo, reviewed like anything else.

Carries over the verification that has already caught a real silent
failure: a mandatory POST (403 means the image was built with the
wrong build-time origin) and an unconditional static-init re-run on
production. Adds per-environment trees, tags, project names, and
the env-file indirection that a non-interactive ssh shell needs
exported inline."
```

---

### Task 4: Rewrite `docs/architecture.md` §10, §13, §14

**Files:**
- Modify: `docs/architecture.md` — lines 9, 27, 148, 149, 151, 152, 191, 192, and all of §14 (195–273)

**Interfaces:**
- Consumes: everything decided in Tasks 1–3.
- Produces: the authoritative §14 that `deploy/runbook.md` (Task 5) and `CLAUDE.md` (Task 6) cite.

- [ ] **Step 1: Fix the two summary references**

Line 9: `a DigitalOcean Droplet in BLR1` → `a Hostinger VPS in Mumbai`.

Line 27 (decision-summary table row): `**DigitalOcean Droplet (BLR1)**; staging + production on one box; images built on the box from a checkout; deploys run by hand (§14)` → `**Hostinger VPS (Mumbai)**; staging + production on one box; images built on the box from a checkout; deploys run by hand (§14)`.

- [ ] **Step 2: Rewrite §10's monitoring and backup bullets**

Replace the monitoring bullet (line 148) with:

```markdown
- **Monitoring is external and minimal — and currently incomplete.** *Revised 2026-08-13:* the DigitalOcean Uptime checks this section previously specified (liveness probes plus an **SSL-expiry alert** on the production hostname) went away with DigitalOcean, and **no replacement has been chosen** (`docs/project-dependencies.md` §6.14). State the consequence plainly: a silently failed certbot renewal now surfaces as an outage on expiry day rather than as a warning weeks earlier. The daily `nginx -s reload` (§14.5) still picks up *successful* renewals; it is the failure path that lost its alarm. **Sentry (free tier), server-side only** — `app` and `jobs` report errors; there is no client-side Sentry, so no added JS and no CSP change; event content is scrubbed per §13. The OTP-send and geocode budget alarms (§13) are SendGrid emails to the ops address.  Compose logs remain the forensic layer, within the §13 content rules.
```

Replace the backup-verification bullet (line 149) with:

```markdown
- **Backup success is verified, not assumed — once there is a backup to verify.** The mechanism is built and unchanged: after each nightly run `scripts/backup.sh` checks that `restic snapshots` actually gained one, then pings a dead-man's-switch (healthchecks.io); a missed ping emails ops. Without it, a wedged cron or an expired credential silently converts the accepted 24-hour RPO into unbounded loss. See the deferral below — that is the state the platform is in right now.
```

Replace the restic bullet (line 152) with:

```markdown
- **Off-box backup storage is UNRESOLVED, and this is a launch blocker.** *Revised 2026-08-13:* the restic repository was a DigitalOcean Spaces bucket in BLR1; moving to Hostinger (§14) left it with no home, and no replacement has been chosen (`docs/project-dependencies.md` §6.9). The requirements on whatever is chosen are unchanged: India-resident, and encrypted at rest — the nightly `pg_dump` contains DPDP-regulated personal data (contacts, home wards, consent records, identity-linked issue votes), which is why restic was chosen over rclone in the first place. Repository key held off-box, admin-only; restore rehearsed before it is needed (dependency register §6.9).
  - **Until it is resolved, production runs with no off-box backup at all.** The RPO below is not merely 24 hours — it is unbounded: losing the box's disk loses everything since seeding. The nightly cron entry (`deploy/crontab`) is deliberately left **active**, so `scripts/backup.sh` fails its `RESTIC_REPOSITORY` check and logs an error every night at 02:00. That noise is the point. Commenting the line out is how "we will wire backups later" becomes "we never wired backups".
```

Update the RPO bullet (line 151): `losing the Droplet's disk` → `losing the box's disk`, and append: ` **As of 2026-08-13 this target is not met** — see the backup deferral above.`

- [ ] **Step 3: Rewrite §13's two accepted-risk bullets**

Line 191 (backups sharing a region) becomes:

```markdown
  - Backup isolation is currently moot: there is no off-box backup (§10). The prior decision — India residency for the DPDP-regulated dump beating disaster isolation, accepting that a region-wide provider failure would take the site and its backups together — stands as the rule for whatever storage is chosen next, but nothing satisfies it today. Provider snapshots, if enabled, share the box's provider and region too.
```

Line 192: `if the Droplet's disk dies` → `if the box's disk dies`; and after `Recovery targets: §10.` append ` Both of these describe the intended steady state; §10 records what is actually in place as of 2026-08-13.`

Also add, at the end of §13's accepted-risk list:

```markdown
  - **Deploys run as `root` on the box** (§14.4). The prior design specified a dedicated key-only `deploy` user, but that user had to be in the `docker` group, which is root-equivalent on the host — so it read as privilege separation while providing none. Root SSH stays key-only with password authentication disabled. The real control is key custody, and it is worth saying that outright rather than implying an isolation boundary that never existed.
```

- [ ] **Step 4: Rewrite §14's heading and §14.1**

```markdown
## 14. Deployment (Hostinger VPS)

Decided 2026-07-19; **provider revised 2026-08-13**. The single VM of §3 is a **Hostinger VPS**. Design history: `docs/superpowers/specs/2026-07-19-digitalocean-deployment-design.md` for the shape of the deployment (still the reasoning in force), `docs/superpowers/specs/2026-08-13-hostinger-deployment-design.md` for the provider move.

### 14.1 Region & compute

One Hostinger VPS, **4 vCPU / 16 GB / 193 GB**, in **Mumbai** — the audience is Bengaluru; this is the closest India region on offer. This replaces the never-provisioned 2 vCPU / 4 GB BLR1 Droplet, and is materially larger than the size §12's k6 test was written to validate. That test still matters — it exercises nginx cache behaviour and rate-limit zone sizing, not just CPU — but the remediation if it falls short is a Hostinger plan upgrade rather than a Droplet resize.

**There is no Reserved-IP equivalent.** DNS points straight at the VPS's own address (`76.13.244.198`), so rebuilding or replacing the box requires a DNS change and a propagation wait — a real regression against the prior design, accepted because the alternative is a floating-IP product not offered at this tier. Keep record TTLs at 300 during any cutover. The box also has a global IPv6 address (`2a02:4780:12:4759::1`); `AAAA` records are published only once its public reachability is confirmed, because Let's Encrypt prefers `AAAA` when present and fails issuance if it cannot reach it.
```

- [ ] **Step 5: Update §14.2**

Change the section heading to `### 14.2 Two environments, one box`, both hostname mentions to `staging-bengaluruvotes.opencity.in`, and the final "Accepted trade" bullet's `chosen over a second Droplet` → `chosen over a second box`. In that same bullet, replace `a 2 vCPU box (§14.2)` phrasing where it appears in §14.3 (next step) rather than here; here, append to the bullet:

```markdown
 The 4 vCPU / 16 GB box (§14.1) makes this contention less acute than the 2 vCPU Droplet would have — not harmless.
```

- [ ] **Step 6: Rewrite §14.3's opening and add the checkout layout**

Replace `built **on the Droplet**` with `built **on the box**`, `CI-built public GHCR images, Droplet pulls only` with `CI-built public GHCR images, the box pulls only`, and the "Builds compete" bullet's `on a 2 vCPU box (§14.2)` with `with live production traffic (§14.2)`.

Then append this subsection to §14.3:

````markdown
**Two checkouts, one per environment** (added 2026-08-13). Each stack builds from its own tree, so no ref juggling is needed and `git log -1` in either directory is an honest answer to "what is running here" — which a single shared checkout cannot give:

```
/root/src/bengaluru-votes-staging       tracks origin/main
/root/src/bengaluru-votes-production    detached on an annotated tag vYYYY.MM.DD
/etc/bengaluru-votes/.env.staging       mode 600, outside both trees
/etc/bengaluru-votes/.env.production    mode 600, outside both trees
```

The Compose project name is **pinned in each compose file** (`bengaluru-votes-production`, `bengaluru-votes-staging`). Compose would otherwise infer it from the directory holding the file — `deploy/` in both trees — merging the two stacks into one project namespace. Those names must never change on a live box: a new project name means a new, empty `pg_data` volume, which presents as the database having vanished.

**Promotion is a rebuild, never an image copy.** `astro.config.mjs` resolves `site` and `security.allowedDomains` at *build* time, so the staging and production images differ even at an identical commit. There is no promoting a verified staging artifact — production always rebuilds from the tag. This is also why the two stacks use distinct local tags (`bengaluru-votes-staging:*` vs `bengaluru-votes:*`): a shared tag would mean deploying staging silently swaps the image production restarts onto.
````

- [ ] **Step 7: Rewrite §14.4's release flow**

Replace the numbered sequence with:

````markdown
`deploy/deploy.sh` (committed) runs the whole sequence and verifies it:

```sh
deploy/deploy.sh staging                  # build+deploy origin/main
deploy/deploy.sh production v2026.08.14   # build+deploy that annotated tag
deploy/deploy.sh <env> --rollback         # retag :previous, restart, re-verify
```

What it does, per stack: preflight (ssh, tree exists and is clean, env file present) → tag the current image `:previous` **before** the build overwrites `:latest` → update that environment's tree to its ref → build with that environment's `SITE_ORIGIN` → migrate (§14.7) → `up -d` → **production only:** re-run `static-init` unconditionally → verify.
````

Then update the surrounding bullets:

- **Branch policy** (new bullet, first): `**Staging is `origin/main`; production is a tag.** After staging verifies a commit, that exact commit is tagged `vYYYY.MM.DD` (`.2` for a second same-day release) and pushed; production checks it out detached. Tagging is the human judgement in the loop — nothing automates the decision that a commit is production-worthy.`
- **Staging first** bullet: keep as-is.
- **Versioning** bullet: change `still worth tagging in git so "how old is what's live" has an answer, even though no tag triggers anything` → `the tag is not decoration: it is the ref production is checked out on`.
- **Rollback** bullet: `docker image tag <image>:previous <image>:latest` stays; append ` — `deploy/deploy.sh <env> --rollback` does this, restarts, and re-verifies.`
- **Access** bullet: replace with `**Access:** SSH to the box as `root`, key-only, password authentication disabled. The prior design's dedicated `deploy` user is dropped — see §13 for why it was ceremony rather than privilege separation.`
- The final bullet about `.claude/skills/deploy-vps/` being "the working reference for the interim VPS" is deleted; the script is now the real thing and is named above.

- [ ] **Step 8: Rewrite §14.5**

```markdown
### 14.5 Network & TLS

Inbound 22, 80, 443 only, enforced by **`ufw` on the box** (the prior design used a DigitalOcean Cloud Firewall; Hostinger's panel firewall may be layered on top, but the committed anchor is `ufw` — `deploy/runbook.md`). SSH is key-only; password authentication and root password login disabled. TLS is Let's Encrypt via a **certbot container** in the production stack: HTTP-01 for both hostnames (nginx routes `/.well-known/acme-challenge/` to the shared webroot volume), certificates on a volume shared with nginx. The reload mechanism is chosen, not hand-waved: the nginx container runs a **daily `nginx -s reload` timer** — a no-op when nothing changed — so renewed certificates take effect without giving certbot a docker-socket mount. **What is missing:** the SSL-expiry alert that used to catch a silently failed renewal weeks early came from DigitalOcean Uptime and has no replacement (§10). "nginx terminates TLS" (§3) is unchanged.
```

- [ ] **Step 9: Rewrite §14.6**

```markdown
### 14.6 Provisioning runbook

No Terraform — one box doesn't justify it. Provisioning is `deploy/runbook.md`:

1. Point DNS for both hostnames at the VPS's IPv4 (`A` only at first; `AAAA` after IPv6 reachability is confirmed — §14.1).
2. Harden the host: `ufw` allowing 22/80/443, SSH key-only, no password auth.
3. Install Docker Engine + Compose plugin.
4. Clone the repo twice (§14.3's per-environment trees); write the two `.env` files (mode 600, outside both checkouts — §13).
5. Generate the staging basic-auth htpasswd; bootstrap self-signed certs so nginx can start; bring production up; issue real certs; bring staging up.
6. Seed wards on both, the first admin on production, demo content on staging.
7. Verify both hostnames **including a real POST** (§14.4), then retire the interim preview stack.
8. Initialize the restic repository and rehearse a restore — **blocked**: no backup target has been chosen (§10, dependency register §6.9).

Step 6's admin seed is the root of the authorization chain: a one-time CLI (`docker compose run --rm app npm run seed:admin -- <address>`) inserts the named admin identity, since OTP-only auth means role is nothing but a DB field. Every later role grant is an admin action in `/admin`, audit-logged; role is never inferred from the authenticating address.
```

- [ ] **Step 10: Rewrite §14.8**

```markdown
### 14.8 Running cost

VPS (already paid for, shared with other workloads) + **$0 backups and $0 monitoring — because neither exists yet** (§10). The prior estimate was ~$34–35/mo on DigitalOcean (Droplet $28 + Spaces $5 + snapshots $1–2). Whatever off-box backup storage is chosen (dependency register §6.9) adds a few dollars a month; an uptime/SSL monitor (§6.14) is free at the tiers this project needs. Messaging, geocoding, and Anthropic spend sit on top and remain the dominant unknown (§6.11).
```

- [ ] **Step 11: Verify no DigitalOcean references survive in this file**

Run:

```sh
grep -niE "digitalocean|digital ocean|droplet|blr1|doctl|spaces" docs/architecture.md
```

Expected: matches ONLY where the text deliberately describes what changed and why — the §14 design-history line, the §10/§13 "revised 2026-08-13" clauses, and §14.3's account of the superseded GHCR design. Every match must be a sentence about history, not a live claim. If any match asserts current fact, fix it.

- [ ] **Step 12: Commit**

```sh
git add docs/architecture.md
git commit -m "docs(architecture): rewrite §14 for the Hostinger VPS

Provider, sizing, firewall, and provisioning change; the runtime
topology does not. Adds the per-environment checkout layout and
branch policy (§14.3/§14.4) and the pinned Compose project names.

Records two things rather than papering over them: there is no
off-box backup and no SSL-expiry alarm, both lost with DigitalOcean
and neither replaced. §10 now says the 24-hour RPO is not met."
```

---

### Task 5: Rewrite `deploy/runbook.md`

**Files:**
- Modify: `deploy/runbook.md` — §0 through §7, the env table's restic rows, "Deploying", and the k6 section

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: the exact provisioning commands Tasks 7–9 execute.

- [ ] **Step 1: Replace §0 Prerequisites**

```markdown
## 0. Prerequisites

- SSH access to the Hostinger VPS as `root` (key-only). `76.13.244.198`;
  the box is `srv1408795.hstgr.cloud` until DNS is cut over.
- Ownership/delegation of the `opencity.in` DNS zone (Oorvani's domain) —
  you need to create two `A` records under it.
- **Off-box backup storage: UNRESOLVED** (dependency register §6.9;
  `docs/architecture.md` §10). There is no restic target, so step 6 below
  cannot be completed and the platform runs with no off-box backup. This is
  a launch blocker, not a nice-to-have.
- The vendor accounts this app talks to — SendGrid, Twilio, Google Cloud
  (Geocoding + Programmable Search), Anthropic, reCAPTCHA v3, Google
  Analytics, Sentry, healthchecks.io. **None are available as of
  2026-08-13.** Each absence degrades to a documented no-op rather than an
  error (see the env table below for what each one costs), so provisioning
  proceeds without them.
```

- [ ] **Step 2: Replace §1 and §2**

```markdown
## 1. Harden the host

The prior design used a DigitalOcean Cloud Firewall; on this box the
committed anchor is `ufw` (`docs/architecture.md` §14.5). Inbound 22, 80,
443 only — Postgres and the app port are never reachable from the internet.

```sh
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
```

`ufw` and Docker's published ports interact badly in general — Docker writes
its own iptables rules that bypass ufw's INPUT chain. That is acceptable
here precisely because the only published ports are 80 and 443, which ufw
allows anyway. Do not publish any other port expecting ufw to hide it.

SSH: key-only, no passwords, no root password login.

```sh
sed -i \
  -e 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' \
  -e 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config
systemctl restart ssh
```

Confirm you can still open a **second** session before closing the first.

## 2. DNS

Point both hostnames at the VPS (dependency register §6.8 — under Oorvani's
`opencity.in` zone):

```
bengaluruvotes.opencity.in.          300  IN  A  76.13.244.198
staging-bengaluruvotes.opencity.in.  300  IN  A  76.13.244.198
```

**`A` only, deliberately.** The box has a global IPv6 address
(`2a02:4780:12:4759::1`) but its public reachability is unverified, and
Let's Encrypt *prefers* `AAAA` when one exists and fails issuance outright
if it cannot reach it — publishing an unverified `AAAA` is the easiest way
to make certbot fail in a way that reads as a DNS problem. Add `AAAA` after
step 5 succeeds and IPv6 is confirmed working from outside.

TTL 300 during cutover; raise to 3600 once stable. Verify propagation before
step 5 (certbot's HTTP-01 challenge fails otherwise):

```sh
dig +short bengaluruvotes.opencity.in
dig +short staging-bengaluruvotes.opencity.in
```
```

- [ ] **Step 3: Replace §3 and §4**

```markdown
## 3. Docker Engine and Compose

```sh
curl -fsSL https://get.docker.com | sh
docker compose version
```

Deploys run as `root` (`docs/architecture.md` §14.4). The prior design's
dedicated `deploy` user is dropped: it had to be in the `docker` group,
which is root-equivalent on the host, so it read as privilege separation
while providing none. §13 records that trade.

## 4. Two checkouts and the `.env` files

One tree per environment (`docs/architecture.md` §14.3). These are not just
a source of Compose files — since images are built on the box, each tree is
what its stack builds *from*, so the ref it sits on is the version that
ships.

```sh
mkdir -p /root/src
git clone git@github.com:snarayanank2/bengaluru-votes.git /root/src/bengaluru-votes-staging
git clone git@github.com:snarayanank2/bengaluru-votes.git /root/src/bengaluru-votes-production

cd /root/src/bengaluru-votes-staging    && git checkout main
cd /root/src/bengaluru-votes-production && git fetch --tags && git checkout <vYYYY.MM.DD>
```

Env files go **outside both trees**, mode 600 (`docs/architecture.md` §13),
so a checkout can be deleted and re-cloned without touching secrets:

```sh
mkdir -p /etc/bengaluru-votes
touch /etc/bengaluru-votes/.env.production /etc/bengaluru-votes/.env.staging
chmod 600 /etc/bengaluru-votes/.env.*
```

Fill each in from the **Required environment variables** tables below.
Generate the secrets on the box:

```sh
openssl rand -hex 32     # SESSION_SECRET — a DIFFERENT value per environment
openssl rand -hex 24     # POSTGRES_PASSWORD — likewise
```

The Compose files read these paths through `PROD_ENV_FILE` /
`STAGING_ENV_FILE`. `deploy/deploy.sh` exports them inline on every remote
command — deliberately, because `ssh host 'cmd'` is a non-interactive shell
that does not source `~/.bashrc`, so a profile export would silently not
apply and Compose would fall back to a `./.env.<env>` that does not exist.
When running Compose by hand, export them yourself:

```sh
export PROD_ENV_FILE=/etc/bengaluru-votes/.env.production
export STAGING_ENV_FILE=/etc/bengaluru-votes/.env.staging
```
```

- [ ] **Step 4: Replace §5**

```markdown
## 5. First certs and first boot

Certbot needs nginx up to answer the HTTP-01 challenge, but nginx needs
certs to start its `443 ssl` server blocks — bootstrap with a throwaway
self-signed pair first, issue real certs against the running stack, then
reload.

All commands below run from the **production** checkout, which owns nginx,
certbot, and the `gba_front` network.

```sh
cd /root/src/bengaluru-votes-production
export PROD_ENV_FILE=/etc/bengaluru-votes/.env.production
COMPOSE="docker compose -p bengaluru-votes-production -f deploy/compose.production.yml"

# --- 5a. Throwaway self-signed certs so nginx can start at all ----------
$COMPOSE run --rm --entrypoint sh certbot -c '
  set -e
  for host in bengaluruvotes.opencity.in staging-bengaluruvotes.opencity.in; do
    mkdir -p /etc/letsencrypt/live/$host
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout /etc/letsencrypt/live/$host/privkey.pem \
      -out /etc/letsencrypt/live/$host/fullchain.pem \
      -subj "/CN=$host"
  done
'

# --- 5b. Staging basic-auth htpasswd -----------------------------------
# MUST exist as a real FILE before the first `up`: compose.production.yml
# bind-mounts ./nginx/staging.htpasswd read-only, and Docker turns a
# bind-mount of a non-existent host path into an empty DIRECTORY, which then
# fails nginx's auth_basic_user_file load. Gitignored, never committed.
docker run --rm httpd:2-alpine htpasswd -Bbn <tester-username> '<tester-password>' \
  > /root/src/bengaluru-votes-production/deploy/nginx/staging.htpasswd

# --- 5c. Production up (owns the shared nginx + gba_front) --------------
$COMPOSE up -d

# --- 5d. Real certs, one certbot run per hostname ----------------------
$COMPOSE run --rm certbot certbot certonly --webroot -w /var/www/certbot \
  -d bengaluruvotes.opencity.in --email ops@opencity.in --agree-tos --non-interactive
$COMPOSE run --rm certbot certbot certonly --webroot -w /var/www/certbot \
  -d staging-bengaluruvotes.opencity.in --email ops@opencity.in --agree-tos --non-interactive

$COMPOSE exec nginx nginx -s reload

# --- 5e. Staging up (joins gba_front, which now exists) ----------------
cd /root/src/bengaluru-votes-staging
export STAGING_ENV_FILE=/etc/bengaluru-votes/.env.staging
docker compose -p bengaluru-votes-staging -f deploy/compose.staging.yml up -d
```

**Port contention with the interim stack.** The old `/root/vps-deploy` stack
also binds 80. Stop it immediately before 5c (`cd /root/vps-deploy && docker
compose down`) and do not remove its volumes until step 7's verification
passes — that is the rollback if this cutover goes wrong.

Verify both hostnames serve real certs:

```sh
curl -sI https://bengaluruvotes.opencity.in/healthz
curl -sI -u <tester-username>:<tester-password> https://staging-bengaluruvotes.opencity.in/healthz
```
```

- [ ] **Step 5: Replace §6**

```markdown
## 6. restic — BLOCKED

**No off-box backup target has been chosen** (dependency register §6.9;
`docs/architecture.md` §10). `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `HEALTHCHECKS_URL` are
therefore unset in both `.env` files, and `scripts/backup.sh` fails its
required-variable check every night at 02:00 in the `jobs` container's log.

That nightly failure is intentional and should stay noisy until the target
exists. **Production is running with no off-box backup**: the stated 24-hour
RPO is not merely missed, it is unbounded.

Once a target is chosen, the remaining work is exactly:

```sh
set -a; source /etc/bengaluru-votes/.env.production; set +a
restic init

# Rehearse a restore NOW, before you need one — against a scratch directory,
# never over the live data dir:
docker compose -p bengaluru-votes-production -f deploy/compose.production.yml run --rm \
  -e DATABASE_URL -e RESTIC_REPOSITORY -e RESTIC_PASSWORD \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  app sh -c '
    restic snapshots &&
    restic dump latest --tag pg_dump > /tmp/rehearsal.dump &&
    pg_restore --list /tmp/rehearsal.dump | head -20
  '
```

Confirm the snapshot list is non-empty and `pg_restore --list` shows real
table entries. Record the rehearsal date where ops can find it.
```

- [ ] **Step 6: Replace §7 with seeding for both environments**

```markdown
## 7. Seed

Wards first — everything else depends on them.

```sh
# Production: the real 369 wards, then the first admin.
cd /root/src/bengaluru-votes-production
export PROD_ENV_FILE=/etc/bengaluru-votes/.env.production
COMPOSE="docker compose -p bengaluru-votes-production -f deploy/compose.production.yml"
$COMPOSE run --rm app npm run seed:wards
$COMPOSE run --rm app npm run seed:admin -- <admin-email>

# Staging: wards, plus the deliberately-fictional demo content. seed:dev
# refuses to run under NODE_ENV=production and staging's .env sets exactly
# that, so the override is explicit and knowing — never copy this to
# production.
cd /root/src/bengaluru-votes-staging
export STAGING_ENV_FILE=/etc/bengaluru-votes/.env.staging
COMPOSE_S="docker compose -p bengaluru-votes-staging -f deploy/compose.staging.yml"
$COMPOSE_S run --rm app-staging npm run seed:wards
$COMPOSE_S run --rm -e NODE_ENV=development app-staging npm run seed:dev
```

`scripts/seed-admin.ts` upserts a `users` row with `role='admin'` for that
email — idempotent, safe to re-run. It is the root of the authorization
chain: every later role grant is an admin action in `/admin`, itself
audit-logged, and role is never inferred from the authenticating address
anywhere else in this app.
```

- [ ] **Step 7: Update the env-variable tables**

In the `.env.production` table:

- `SITE_ORIGIN` row: unchanged (`https://bengaluruvotes.opencity.in`).
- `RESTIC_REPOSITORY` row: change Required? to `**blocked**` and the purpose to `No target chosen — dependency register §6.9. Leave unset; scripts/backup.sh fails loudly nightly until it exists.`
- `RESTIC_PASSWORD` row: purpose becomes `restic repository encryption password. Unset until §6.9 resolves. Custody: dependency register §6.10.`
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` row: purpose becomes `Credentials for whatever S3-compatible backup storage §6.9 settles on (restic's s3 backend reads the standard AWS_* vars). Unset today.`
- `HEALTHCHECKS_URL` row: purpose becomes `healthchecks.io ping URL — the nightly backup dead-man's-switch. Only meaningful once backups exist (§6.9).`
- `IMAGE_TAG` row: unchanged.

In the `.env.staging` section, change `SITE_ORIGIN=https://staging.bengaluruvotes.opencity.in` to `SITE_ORIGIN=https://staging-bengaluruvotes.opencity.in`. The two deliberate differences (`SENDS_DISABLED=true`, vendor keys omitted entirely) are unchanged — note that with no vendor keys available at all right now, guard #2 currently holds trivially on both environments, which is not a reason to relax either guard later.

- [ ] **Step 8: Replace the "Deploying" section**

```markdown
## Deploying

Deploys are **manual** (`docs/architecture.md` §14.4). There is no CI, no
registry, and nothing that fires on push, merge or release. Images are built
on the box from the per-environment checkouts (§14.3).

**Run the checks first — nothing else will.** On your machine, not the box:

```sh
npm run translate -- --check   # bilingual completeness (§9)
npm run typecheck
npm test
```

### Staging

Staging is whatever is on `main`. Push, then:

```sh
git push origin main
STAGING_USER=<tester-username> STAGING_PASS=<tester-password> \
  deploy/deploy.sh staging
```

Then **look at it in a browser**. That is the point of staging.

### Production

Tag the exact commit staging verified, then deploy that tag:

```sh
git tag -a v2026.08.14 -m "release" origin/main
git push origin v2026.08.14
deploy/deploy.sh production v2026.08.14
```

**Deploy staging first, always.** No pipeline enforces the order any more,
and staging-before-production is the only thing that exercises a migration
before it touches real citizen data (§14.7).

### What the script does, and why each step is there

1. **Preflight** — ssh reachable, the tree exists and is clean, the env file
   is present. A dirty tree stops the deploy: someone edited the box, and
   clobbering that automatically is never right.
2. **Tag `:previous`** — before the build, because the build overwrites
   `:latest`. There is no registry; this image on this box is the entire
   rollback story.
3. **Update the tree** to `origin/main` (staging) or the tag (production,
   detached).
4. **Build** with that environment's `SITE_ORIGIN`.
5. **Migrate** — forward-only and idempotent; a failure aborts before
   anything restarts, so the running version continues against the
   unchanged schema.
6. **`up -d`**.
7. **Production only: re-run `static-init`, unconditionally.** `up -d` does
   not re-run a one-shot that already succeeded, so skipping it serves the
   previous build's hashed `/_astro/*` filenames against new HTML and every
   page 404s its own CSS and JS.
8. **Verify, including a real POST.** A stack built with the wrong origin
   serves every page a healthy 200 and 403s every write, and nothing in
   `docker compose ps`, the healthcheck, or the logs reveals it:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/healthz
curl -sS -X POST https://<host>/api/ward-lookup \
  -H 'content-type: application/json' -H 'Origin: https://<host>' \
  -d '{"pincode":"560102"}'      # 403 here means rebuild
```

### Cold boot ordering

Production comes up before staging. Production owns the `gba_front` network;
staging joins it as `external: true` and its `up` fails outright if that
network does not exist yet.
```

- [ ] **Step 9: Update the k6 section**

Change the `BASE_URL` example to `https://staging-bengaluruvotes.opencity.in`; change `architecture §14.6: 2 vCPU / 4 GB` to `architecture §14.1: 4 vCPU / 16 GB`; change "NOT the Droplet" to "NOT the VPS"; change "outside BLR1" to "outside Mumbai"; and replace the remediation paragraph's `doctl compute droplet-action resize …` with:

```markdown
**If it fails:** the accepted remediation is a **plan upgrade** on the
Hostinger VPS (`docs/architecture.md` §14.1) followed by a re-run of this
same k6 command. This is explicitly NOT meant to trigger a
re-architecture — the whole point of the single-VM design's k6 gate is
"resize if short, don't redesign." If the `rate_limited_429` threshold
specifically fails (not the RPS/latency ones), that's a rate-limits.conf
zone-sizing question instead (§7) — revisit the zone rate/burst, not the
box size.
```

Also update the "Rollback" pointer at the end of the file to use the
project-name-pinned commands:

```sh
docker image tag bengaluru-votes:previous bengaluru-votes:latest
docker compose -p bengaluru-votes-production -f deploy/compose.production.yml up -d
docker compose -p bengaluru-votes-production -f deploy/compose.production.yml run --rm static-init
```

and note that `deploy/deploy.sh production --rollback` does exactly this and
then re-verifies.

- [ ] **Step 10: Verify**

Run:

```sh
grep -niE "digitalocean|droplet|blr1|doctl|reserved.ip|spaces" deploy/runbook.md
grep -n "staging\.bengaluruvotes" deploy/runbook.md
```

Expected: the first returns only sentences describing what changed (e.g. "the prior design used a DigitalOcean Cloud Firewall"); the second returns nothing.

- [ ] **Step 11: Commit**

```sh
git add deploy/runbook.md
git commit -m "docs(runbook): provision the Hostinger VPS, not a Droplet

ufw instead of a cloud firewall, two per-environment checkouts under
/root/src, root instead of a deploy user, and the port-80 contention
with the interim stack called out as the one hard cutover ordering
constraint.

Step 6 (restic) is marked BLOCKED rather than rewritten against a
substitute bucket: no backup target has been chosen."
```

---

### Task 6: Remaining provider references and the grep gate

**Files:**
- Modify: `CLAUDE.md:57,167`
- Modify: `.gitignore:15`
- Modify: `deploy/compose.local.yml:8,49`
- Modify: `deploy/compose.production.yml` (header comment, lines 31–35)
- Modify: `deploy/crontab:46`
- Modify: `scripts/backup.sh:4,18,22-23`
- Modify: `src/lib/affidavit-fetch.ts:8`
- Modify: `docs/project-dependencies.md` §6.1, §6.9, §6.14, §6.16 and the §6.16 note

- [ ] **Step 1: `CLAUDE.md`**

Line 57: `The other two Compose files (\`compose.staging.yml\`, \`compose.production.yml\`) target the Droplet` → `target the VPS`.

Line 167 (fixed decisions): replace the whole bullet with:

```markdown
- **Deployment:** one Hostinger VPS (Mumbai, 4 vCPU / 16 GB) running staging + production Compose stacks, from **two checkouts** under `/root/src` — staging tracks `origin/main`, production sits detached on a `vYYYY.MM.DD` tag. **There is no CI and no registry** (removed 2026-08-13): images are built on the box, and deploys are run by hand with `deploy/deploy.sh`. Nothing fires on push, merge or release. `deploy/runbook.md` ("Deploying") is the procedure; `architecture.md` §14.3/§14.4 is the design. Moved off the never-provisioned DigitalOcean Droplet on 2026-08-13.
```

Add one bullet to the "Gotchas that bite silently" section:

```markdown
- **No off-box backup exists.** The nightly `scripts/backup.sh` cron fails every night by design until a restic target is chosen (`architecture.md` §10, dependency register §6.9). Losing the box's disk loses everything. Don't read the working backup *mechanism* as a working backup.
```

- [ ] **Step 2: `.gitignore:15`**

`# generated on the Droplet by deploy/runbook.md step 5, never committed.` → `# generated on the box by deploy/runbook.md step 5, never committed.`

- [ ] **Step 3: `deploy/compose.local.yml`**

Line 8: `(its cron entries need restic + DO Spaces + healthchecks.io` → `(its cron entries need restic + off-box storage + healthchecks.io`.

Line 49: `Same Dockerfile the Droplet images are built from` → `Same Dockerfile the deployed images are built from`.

- [ ] **Step 4: `deploy/compose.production.yml` header**

Lines 31–35: `On the Droplet this is written by the provisioning runbook (architecture §14.6 step 4, "outside the repo", mode 600) and kept in sync at that path` → `On the box this is written by the provisioning runbook (architecture §14.6 step 4) at /etc/bengaluru-votes/.env.production, mode 600, outside both checkouts, and reached through the PROD_ENV_FILE override below`.

- [ ] **Step 5: `deploy/crontab:46`**

```
# Nightly backup — pg_dump -> restic -> verify snapshot count increased ->
# healthchecks.io ping. See scripts/backup.sh's header for the required env
# vars. LEFT ACTIVE DELIBERATELY while no backup target exists (architecture
# §10, dependency register §6.9): backup.sh fails its RESTIC_REPOSITORY
# check and logs an error here every night, which is the reminder. Do not
# comment this out to quiet the log.
```

- [ ] **Step 6: `scripts/backup.sh` comments**

Line 4: `restic (encrypted, shipped to a DigitalOcean Spaces bucket)` → `restic (encrypted, shipped to off-box S3-compatible storage)`.

Line 18: `e.g. s3:https://<region>.digitaloceanspaces.com/<bucket>` → `e.g. s3:https://<endpoint>/<bucket>`.

Lines 22–23: `DO Spaces access key (restic's s3 backend reads / the standard AWS_* env vars; Spaces is S3-compatible).` → `Access key for the S3-compatible backup / storage (restic's s3 backend reads the standard AWS_* env vars).`

Add after the required-env block's closing line:

```sh
# NOTE (2026-08-13): no backup target has been chosen yet (architecture §10,
# dependency register §6.9), so RESTIC_REPOSITORY is unset in production and
# this script exits 1 nightly. That is intentional — see deploy/crontab.
```

Do not change any code in this file. It is already provider-neutral.

- [ ] **Step 7: `src/lib/affidavit-fetch.ts:8`**

`server into an open SSRF proxy against the Droplet's own metadata service` → `server into an open SSRF proxy against the host's own metadata service`.

- [ ] **Step 8: `docs/project-dependencies.md`**

§6.1: `decided: a DigitalOcean Droplet in BLR1 running Docker Compose, staging and production on the one box` → `decided: a Hostinger VPS in Mumbai (4 vCPU / 16 GB) running Docker Compose, staging and production on the one box; revised 2026-08-13 from a DigitalOcean Droplet that was never provisioned`.

§6.9: replace the Dependency cell with:

```markdown
**Off-box backup storage** — **UNRESOLVED as of 2026-08-13.** Was a DO Spaces bucket in BLR1; the move to Hostinger (`docs/architecture.md` §14) left it with no home. Requirements on the replacement are unchanged: India-resident, S3-compatible, encrypted at rest via restic (the dump holds DPDP-regulated personal data; §10), plus a rehearsed restore. **Until this lands the platform has no off-box backup and the 24-hour RPO is unbounded.**
```

and change its Blocks cell to `Launch — this is a blocker, not a nice-to-have`.

§6.14: replace the Dependency cell with:

```markdown
**Monitoring accounts** — **partially unresolved as of 2026-08-13.** DigitalOcean Uptime (external liveness + the SSL-expiry alert) went away with the provider move and has no replacement: a silently failed certbot renewal now surfaces as an outage rather than a warning. Still wanted: a Sentry project (free tier, server-side only) and a healthchecks.io check for the backup dead-man's-switch (`docs/architecture.md` §10)
```

§6.16 and its note: `which the Droplet clones and builds from` → `which the box clones and builds from`; `the Droplet builds what it runs from a clone of this repo` → `the box builds what it runs from a clone of this repo`.

Also update the §6.9 prose note at the bottom of the section — `"An unrehearsed backup is not a backup" is a task with a date, not a principle` — by appending: ` As of 2026-08-13 there is no backup to rehearse, which is strictly worse than an unrehearsed one.`

- [ ] **Step 9: The repo-wide grep gate**

Run:

```sh
grep -rniE "digitalocean|digital ocean|droplet|blr1|doctl|digitaloceanspaces" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=worktrees \
  --exclude-dir=specs --exclude-dir=plans --exclude=package-lock.json
```

Expected: every remaining match is a sentence *about history* — "revised 2026-08-13 from…", "the prior design used…", "was a DO Spaces bucket". Zero matches assert current fact. Anything that does is a bug; fix it.

Then:

```sh
grep -rn "staging\.bengaluruvotes\.opencity\.in" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=worktrees \
  --exclude-dir=specs --exclude-dir=plans
```

Expected: no matches at all.

- [ ] **Step 10: Full verification**

```sh
npm run typecheck
npm run translate -- --check
DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/bv_test npm test
bash -n deploy/deploy.sh scripts/backup.sh
```

Expected: all pass. `src/lib/affidavit-fetch.ts` was comment-only; a test failure means something else was edited.

- [ ] **Step 11: Commit**

```sh
git add -A
git commit -m "docs: retire the remaining DigitalOcean references

CLAUDE.md, the dependency register, the crontab, backup.sh's header
and a handful of comments. backup.sh's code is unchanged — it was
already provider-neutral; only its examples named Spaces.

§6.9 and §6.14 become explicit gaps rather than decided rows, and
CLAUDE.md gains a gotcha saying a working backup mechanism is not a
working backup."
```

---

### Task 7: Provision — host prep, checkouts, env files

**Runs against the box.** Everything from here is operational. The interim
`/root/vps-deploy` stack must keep serving until Task 9 verifies.

**Prerequisite:** the DNS records from `deploy/runbook.md` §2 exist and
resolve. Confirm before starting.

- [ ] **Step 1: Confirm DNS**

```sh
dig +short bengaluruvotes.opencity.in
dig +short staging-bengaluruvotes.opencity.in
```

Expected: both print `76.13.244.198`. If either is empty, stop — certbot in Task 8 will fail.

- [ ] **Step 2: Harden the host**

Run `deploy/runbook.md` §1 (`ufw` rules, then the sshd changes). **Open a second SSH session and confirm it works before closing the first.**

- [ ] **Step 3: Create both checkouts**

Per runbook §4. The staging tree on `main`; leave the production tree on `main` for now and check out the release tag in Task 8 — the tag does not exist until the repo work is tagged.

- [ ] **Step 4: Write both `.env` files**

Per runbook §4 and the env tables. Generate `SESSION_SECRET` and `POSTGRES_PASSWORD` separately per environment. Staging gets `SENDS_DISABLED=true` and **no** vendor keys. Both get `RETENTION_ENABLED=false`. Leave every unavailable vendor key unset.

- [ ] **Step 5: Verify the env files are readable by Compose and mode 600**

```sh
ls -l /etc/bengaluru-votes/
cd /root/src/bengaluru-votes-production
PROD_ENV_FILE=/etc/bengaluru-votes/.env.production \
  docker compose -p bengaluru-votes-production -f deploy/compose.production.yml config >/dev/null && echo OK
```

Expected: `-rw------- root root` on both files, and `OK`. A Compose error here names the missing variable — fix it before continuing.

---

### Task 8: Provision — certs and the production stack

- [ ] **Step 1: Tag a release and check the production tree out on it**

On your machine:

```sh
git tag -a v2026.08.13 -m "first Hostinger release" main
git push origin main --tags
```

On the box:

```sh
cd /root/src/bengaluru-votes-production && git fetch --tags && git checkout v2026.08.13 && git log --oneline -1
```

- [ ] **Step 2: Generate the staging htpasswd**

Per runbook §5b, into `/root/src/bengaluru-votes-production/deploy/nginx/staging.htpasswd`. Confirm it is a **file**:

```sh
test -f /root/src/bengaluru-votes-production/deploy/nginx/staging.htpasswd && echo "file ok"
```

- [ ] **Step 3: Bootstrap self-signed certs**

Per runbook §5a. Confirm:

```sh
docker run --rm -v bengaluru-votes-production_certs:/c alpine ls /c/live
```

Expected: both hostname directories exist.

- [ ] **Step 4: Stop the interim stack and bring production up**

```sh
cd /root/vps-deploy && docker compose down     # frees port 80/443
cd /root/src/bengaluru-votes-production
PROD_ENV_FILE=/etc/bengaluru-votes/.env.production \
  docker compose -p bengaluru-votes-production -f deploy/compose.production.yml up -d
docker compose -p bengaluru-votes-production -f deploy/compose.production.yml ps
```

Expected: `nginx`, `app`, `postgres`, `jobs`, `certbot` running; `static-init` exited 0. **Do not remove `/root/vps-deploy`'s volumes** — that stack is the rollback until Task 9 passes.

- [ ] **Step 5: Issue real certs and reload**

Per runbook §5d. Then:

```sh
curl -sI https://bengaluruvotes.opencity.in/healthz | head -1
echo | openssl s_client -connect bengaluruvotes.opencity.in:443 \
  -servername bengaluruvotes.opencity.in 2>/dev/null | openssl x509 -noout -issuer -dates
```

Expected: `HTTP/2 200`, and an issuer naming Let's Encrypt (not the self-signed `CN=bengaluruvotes.opencity.in` stub).

- [ ] **Step 6: Run migrations and seed production**

```sh
cd /root/src/bengaluru-votes-production
export PROD_ENV_FILE=/etc/bengaluru-votes/.env.production
COMPOSE="docker compose -p bengaluru-votes-production -f deploy/compose.production.yml"
$COMPOSE run --rm app npm run migrate
$COMPOSE run --rm app npm run seed:wards
$COMPOSE run --rm app npm run seed:admin -- <admin-email>
```

Expected: migrations apply cleanly; `seed:wards` reports 369 wards.

---

### Task 9: Provision — staging, verification, and retiring the interim stack

- [ ] **Step 1: Bring staging up**

```sh
cd /root/src/bengaluru-votes-staging
export STAGING_ENV_FILE=/etc/bengaluru-votes/.env.staging
COMPOSE_S="docker compose -p bengaluru-votes-staging -f deploy/compose.staging.yml"
$COMPOSE_S up -d
$COMPOSE_S run --rm app-staging npm run migrate
$COMPOSE_S run --rm app-staging npm run seed:wards
$COMPOSE_S run --rm -e NODE_ENV=development app-staging npm run seed:dev
```

Expected: `app-staging`, `postgres-staging`, `jobs-staging` running. If `up` fails with a missing `gba_front`, production is down — fix that first.

- [ ] **Step 2: Verify both environments with the deploy script's own checks**

From your machine:

```sh
STAGING_USER=<tester-username> STAGING_PASS=<tester-password> deploy/deploy.sh staging
deploy/deploy.sh production v2026.08.13
```

Expected: both print the full verification block ending in `verified`, including `POST ward-lookup 200 (not 403 …)`. **A 403 on either means the image was built with the wrong `SITE_ORIGIN` and every form on that site is dead** — do not proceed.

This double-checks the deploy path itself, not just the hand-provisioned stacks: it is the first real exercise of `deploy/deploy.sh` end to end.

- [ ] **Step 3: Verify staging is invisible and isolated**

```sh
curl -sI https://staging-bengaluruvotes.opencity.in/ | head -1          # expect 401
curl -sI -u <u>:<p> https://staging-bengaluruvotes.opencity.in/ | grep -i x-robots-tag   # expect noindex

# The isolation guarantee, proven rather than assumed: no route from a
# staging container to production Postgres.
docker exec $(docker ps -qf name=bengaluru-votes-staging-app-staging) \
  sh -c 'nc -z -w2 postgres 5432 && echo REACHABLE || echo "unreachable (correct)"'
```

Expected: `401`, `X-Robots-Tag: noindex`, and `unreachable (correct)`.

- [ ] **Step 4: Verify the unmatched-host rejection**

```sh
curl -skI https://76.13.244.198/ 2>&1 | head -3
```

Expected: a TLS handshake failure, not a page — `ssl_reject_handshake on` in the `default_server` block. The site must never answer for a hostname it was not configured for.

- [ ] **Step 5: Confirm the backup job fails as designed**

```sh
docker compose -p bengaluru-votes-production -f deploy/compose.production.yml \
  run --rm jobs /app/scripts/backup.sh; echo "exit=$?"
```

Expected: `backup.sh: RESTIC_REPOSITORY is required`, exit 1. This is the intended state until a backup target exists — confirm it is loud, not silent.

- [ ] **Step 6: Retire the interim stack**

Only after every check above passes:

```sh
cd /root/vps-deploy
docker compose down -v          # removes its containers AND volumes (demo data)
cd / && rm -rf /root/vps-deploy /root/src/bengaluru-votes
docker image rm bengaluru-votes:vps bengaluru-votes:previous 2>/dev/null || true
docker image ls
```

Note `/root/src/bengaluru-votes` (the old single checkout) goes too — it is superseded by the two per-environment trees. Leave the new `bengaluru-votes:latest` and `bengaluru-votes-staging:latest` images alone.

- [ ] **Step 7: Add the `AAAA` records, then confirm**

Now that certs are issued, IPv6 can be published without risking issuance:

```
bengaluruvotes.opencity.in.          300  IN  AAAA  2a02:4780:12:4759::1
staging-bengaluruvotes.opencity.in.  300  IN  AAAA  2a02:4780:12:4759::1
```

Then, from an IPv6-capable network:

```sh
curl -6 -sI https://bengaluruvotes.opencity.in/healthz | head -1
```

Expected: `HTTP/2 200`. **If IPv6 does not work from outside, remove the `AAAA` records** — a published-but-unreachable `AAAA` breaks v6-capable clients *and* the next certbot renewal. If no IPv6-capable network is available to test from, skip this step entirely and leave the records `A`-only; nothing depends on IPv6.

- [ ] **Step 8: Raise the DNS TTLs**

Once both hostnames have been stable for a day, raise both records' TTL from 300 to 3600.

- [ ] **Step 9: Record the state**

Append a dated note to `deploy/runbook.md` recording: the provisioning date, the release tag production is on, the admin email seeded, and the two outstanding blockers (no off-box backup, no external monitoring). Commit it.

---

## Verification summary

What "done" means, end to end:

| Check | Where |
|---|---|
| `npm run typecheck`, `npm test`, `npm run translate -- --check` pass | Task 6 step 10 |
| `nginx -t` reports no syntax error | Task 2 step 7 |
| `bash -n deploy/deploy.sh` clean; bad args exit 2; SSH guard fires | Task 3 steps 2–3 |
| No live claim mentions DigitalOcean/Droplet/BLR1/Spaces | Task 6 step 9 |
| No reference to `staging.bengaluruvotes.opencity.in` anywhere | Task 6 step 9 |
| Both hostnames: `GET /` 200 **and** `POST /api/ward-lookup` not 403 | Task 9 step 2 |
| Staging 401s anonymously and sets `X-Robots-Tag: noindex` | Task 9 step 3 |
| No route from a staging container to production Postgres | Task 9 step 3 |
| Bare-IP HTTPS rejects the handshake | Task 9 step 4 |
| `backup.sh` fails loudly rather than silently | Task 9 step 5 |
