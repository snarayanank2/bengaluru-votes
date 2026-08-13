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
  sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'
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
  # curl_auth is populated only for staging. Under `set -u`, expanding an
  # EMPTY array as "${curl_auth[@]}" is a fatal "unbound variable" error on
  # bash 3.2 (macOS's /bin/bash, which is what runs this script) — so every
  # expansion below uses the ${arr[@]+"${arr[@]}"} idiom instead. Do not
  # "simplify" this back to "${curl_auth[@]}".
  local code asset curl_auth=()

  if [ "$ENV_NAME" = staging ]; then
    [ -n "${STAGING_USER:-}" ] && [ -n "${STAGING_PASS:-}" ] \
      || fail "staging verification needs STAGING_USER and STAGING_PASS (nginx basic auth)"
    curl_auth=(-u "$STAGING_USER:$STAGING_PASS")
  fi

  say "Verifying $ORIGIN"

  for path in /healthz / /kn/; do
    code=$(curl -fsS ${curl_auth[@]+"${curl_auth[@]}"} -o /dev/null -w '%{http_code}' "$ORIGIN$path" || true)
    [ "$code" = 401 ] && fail "GET $path returned 401 — wrong STAGING_USER/STAGING_PASS"
    [ "$code" = 200 ] || fail "GET $path returned $code"
    printf '  GET %-10s 200\n' "$path"
  done

  # Catches a stale static_assets volume: the HTML references a hashed asset
  # filename that exists only if static-init copied THIS image's build output.
  asset=$(curl -fsS ${curl_auth[@]+"${curl_auth[@]}"} "$ORIGIN/" | grep -o '/_astro/[^"]*\.js' | head -1 || true)
  [ -n "$asset" ] || fail "no /_astro/ asset referenced in the homepage HTML"
  code=$(curl -fsS ${curl_auth[@]+"${curl_auth[@]}"} -o /dev/null -w '%{http_code}' "$ORIGIN$asset" || true)
  [ "$code" = 200 ] || fail "asset $asset returned $code — static-init did not re-run"
  echo "  $asset  200"

  # The load-bearing check. Status only, never the body: an out-of-coverage
  # pincode is still a valid 200, so this keeps working once
  # data/pincode-wards.json holds real pincodes.
  code=$(curl -fsS ${curl_auth[@]+"${curl_auth[@]}"} -o /dev/null -w '%{http_code}' \
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
