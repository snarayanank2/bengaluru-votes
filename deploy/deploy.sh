#!/usr/bin/env bash
#
# Deploy bengaluru-votes to the Hostinger VPS (architecture.md §14.4).
#
#   deploy/deploy.sh production v2026.08.14   # build+deploy that annotated tag
#   deploy/deploy.sh production --rollback    # retag :previous and restart
#
# Production is the only environment. Staging was retired on 2026-09-18 and
# removed from the repo on 2026-10-13.
#
# Runs entirely over SSH against the box; nothing is built locally. The
# environment's checkout on the box is what gets built, so the ref this
# script lands that tree on IS the version that ships (§14.3).
#
# Env overrides:
#   VPS_SSH_ALIAS   ssh host/alias to deploy to        (default: vps)
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
  production)
    TREE=/root/src/bengaluru-votes-production
    COMPOSE_FILE=deploy/compose.production.yml
    PROJECT=bengaluru-votes-production
    APP_SERVICE=app
    IMAGE=bengaluru-votes:latest
    PREV=bengaluru-votes:previous
    ORIGIN=https://bengaluruvotes.opencity.in
    ENV_VAR="PROD_ENV_FILE=/etc/bengaluru-votes/.env.production"
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
  local code asset

  say "Verifying $ORIGIN"

  for path in /healthz / /kn/; do
    code=$(curl -fsS -o /dev/null -w '%{http_code}' "$ORIGIN$path" || true)
    [ "$code" = 200 ] || fail "GET $path returned $code"
    printf '  GET %-10s 200\n' "$path"
  done

  # Production carries a site-wide banner above the app bar, selected by the
  # APP_ENV runtime var in the compose file (src/lib/env-banner.ts). A missing
  # or misspelled APP_ENV degrades to NO banner, silently, which is why it is
  # asserted here. Matches the element, not the copy, so rewording the
  # banner never breaks the deploy.
  if ! curl -fsS "$ORIGIN/" | grep -q "data-env-banner=\"$ENV_NAME\""; then
    fail "no data-env-banner=\"$ENV_NAME\" in the homepage HTML — APP_ENV is
unset or wrong in this environment's compose file, so the site-wide banner is
missing. On production that is the pre-launch notice every visitor should see."
  fi
  echo "  env banner        present ($ENV_NAME)"

  # Catches a stale static_assets volume: the HTML references a hashed asset
  # filename that exists only if static-init copied THIS image's build output.
  asset=$(curl -fsS "$ORIGIN/" | grep -o '/_astro/[^"]*\.js' | head -1 || true)
  [ -n "$asset" ] || fail "no /_astro/ asset referenced in the homepage HTML"
  code=$(curl -fsS -o /dev/null -w '%{http_code}' "$ORIGIN$asset" || true)
  [ "$code" = 200 ] || fail "asset $asset returned $code — static-init did not re-run"
  echo "  $asset  200"

  # The load-bearing check. Status only, never the body — what is being
  # tested is 403-vs-not (SITE_ORIGIN baked into the image), not whether the
  # lookup succeeds. Every non-403 outcome is a 200: `ward`,
  # `out_of_coverage`, `ambiguous`, and `unavailable` all are, so this keeps
  # working even with no geocoding key or an exhausted budget.
  #
  # Must be an ADDRESS. Pincode lookup was removed 2026-08-14 and a
  # `{"pincode":...}` body is now a 400 — which broke this very check on the
  # first deploy after that change. Cost is at most one geocode per unique
  # address; `geocode_cache` absorbs every deploy after the first.
  code=$(curl -fsS -o /dev/null -w '%{http_code}' \
    -X POST "$ORIGIN/api/ward-lookup" \
    -H 'content-type: application/json' \
    -H "Origin: $ORIGIN" \
    -d '{"address":"MG Road, Bengaluru"}' || true)
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
  # page 404s its own CSS and JS.
  say "Re-populating static assets"
  remote "$COMPOSE run --rm static-init"

  # nginx's config is bind-mounted from this checkout, and `up -d` does not
  # restart nginx when only those files changed, so a config change in this
  # release would otherwise never load. Test first: a reload with a broken
  # config is refused by nginx and the old config keeps serving, but failing
  # here says so instead of leaving it silent.
  say "Reloading nginx config"
  remote "$COMPOSE exec -T nginx nginx -t" 2>&1 | tail -2 || fail "nginx -t rejected the new config; the old config is still serving"
  remote "$COMPOSE exec -T nginx nginx -s reload"

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

REF=$ARG2
[ -n "$REF" ] || fail "production deploys take an explicit tag: deploy/deploy.sh production v2026.08.14"

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
# Detached on an immutable tag: `git log -1` in this tree is then an honest
# answer to "what is production running".
remote "cd $TREE && git fetch --prune --tags origin && git checkout '$REF' && git log --oneline -1"

say "Building $IMAGE"
remote "$COMPOSE build" 2>&1 | tail -5

# Forward-only and idempotent, so this is safe when there is nothing new. A
# failure here aborts the deploy BEFORE any container restarts — the running
# version continues against the unchanged schema.
say "Running migrations"
# `|| true` ONLY on the `grep -v`, not on the whole pipeline: under
# `set -o pipefail`, a `grep -v` that happens to filter every line of output
# (e.g. no npm notices this run) exits 1 on its own, which would abort the
# script right here with a bare exit 1 and no `FAILED:` banner — even though
# the remote migration itself succeeded. `tail -5` can never fail this way
# (it exits 0 on empty input), so it carries no guard, and the remote
# command's own exit status still decides the pipeline's fate. Don't add
# `|| true` to the other pipelines in this file "for consistency" — they
# would then swallow real command failures instead of a display artifact.
remote "$COMPOSE run --rm $APP_SERVICE npm run migrate" 2>&1 | { grep -v '^npm notice' || true; } | tail -5

restart_and_verify
