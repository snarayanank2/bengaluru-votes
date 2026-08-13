#!/usr/bin/env bash
#
# Deploy bengaluru-votes to the interim Hostinger VPS.
# See SKILL.md in this directory for context and failure modes.
#
#   ./deploy.sh              deploy origin/main
#   ./deploy.sh my-branch    deploy some other branch
#   ./deploy.sh --rollback   restore the previously deployed image
#
set -euo pipefail

SSH_ALIAS=${VPS_SSH_ALIAS:-vps}
ORIGIN=${VPS_ORIGIN:-http://srv1408795.hstgr.cloud}
REPO=/root/src/bengaluru-votes
STACK=/root/vps-deploy
IMAGE=bengaluru-votes:vps
PREV=bengaluru-votes:previous

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

remote() { ssh "$SSH_ALIAS" "$@"; }

# ---------------------------------------------------------------------------
# Verification. Deliberately includes a real POST: an image built without the
# two origin build-args serves every GET with a healthy 200 and 403s every
# POST, and nothing else on the box reveals it. A deploy checked with `GET /`
# alone is not verified. See SKILL.md, "The one thing that breaks silently".
# ---------------------------------------------------------------------------
verify() {
  local code asset

  say "Verifying $ORIGIN"

  code=$(curl -fsS -o /dev/null -w '%{http_code}' "$ORIGIN/healthz" || true)
  [ "$code" = 200 ] || fail "/healthz returned $code"
  echo "  /healthz            200"

  code=$(curl -fsS -o /dev/null -w '%{http_code}' "$ORIGIN/" || true)
  [ "$code" = 200 ] || fail "GET / returned $code"
  echo "  GET /               200"

  code=$(curl -fsS -o /dev/null -w '%{http_code}' "$ORIGIN/kn/" || true)
  [ "$code" = 200 ] || fail "GET /kn/ returned $code"
  echo "  GET /kn/            200"

  # Catches a stale static_assets volume: the HTML references a hashed asset
  # filename that only exists if static-init copied THIS image's build output.
  asset=$(curl -fsS "$ORIGIN/" | grep -o '/_astro/[^"]*\.js' | head -1 || true)
  [ -n "$asset" ] || fail "no /_astro/ asset referenced in the homepage HTML"
  code=$(curl -fsS -o /dev/null -w '%{http_code}' "$ORIGIN$asset" || true)
  [ "$code" = 200 ] || fail "asset $asset returned $code — static-init did not re-run"
  echo "  $asset  200"

  # The load-bearing check. 403 here means the image was built without
  # SITE_ORIGIN/EXTRA_ALLOWED_ORIGIN. Asserts on status only, never on the
  # response body: an out-of-coverage pincode is still a valid 200, so this
  # keeps working once data/pincode-wards.json holds real pincodes.
  code=$(curl -fsS -o /dev/null -w '%{http_code}' \
    -X POST "$ORIGIN/api/ward-lookup" \
    -H 'content-type: application/json' \
    -H "Origin: $ORIGIN" \
    -d '{"pincode":"560001"}' || true)
  if [ "$code" = 403 ]; then
    fail "POST /api/ward-lookup returned 403 — image built WITHOUT the origin
build-args. Every form on the site is broken. Rebuild with deploy.sh."
  fi
  [ "$code" = 200 ] || fail "POST /api/ward-lookup returned $code"
  echo "  POST ward-lookup    200 (not 403 — origin args baked in correctly)"

  say "Deploy verified"
}

rollback() {
  say "Rolling back to $PREV"
  remote "docker image inspect $PREV >/dev/null 2>&1" \
    || fail "no $PREV image on the box — nothing to roll back to"
  remote "docker image tag $PREV $IMAGE && cd $STACK && docker compose up -d && docker compose run --rm static-init"
  verify
  exit 0
}

# ---------------------------------------------------------------------------

[ "${1:-}" = "--rollback" ] && rollback
BRANCH=${1:-main}

say "Preflight"
remote true || fail "cannot ssh to '$SSH_ALIAS' (override with VPS_SSH_ALIAS)"
remote "[ -d $STACK ] && [ -f $STACK/.env ]" \
  || fail "$STACK or its .env is missing — this box was never provisioned"

# A dirty checkout means somebody edited that box directly. Stop and let a
# human decide; clobbering their work automatically is never the right call.
if ! remote "cd $REPO && git diff --quiet && git diff --cached --quiet"; then
  remote "cd $REPO && git status --short"
  fail "the checkout at $REPO has local modifications (above). Reconcile them by hand."
fi
echo "  ssh ok, stack present, checkout clean"

say "Tagging the running image as $PREV"
remote "docker image inspect $IMAGE >/dev/null 2>&1 && docker image tag $IMAGE $PREV || echo '  (no current image — first deploy, skipping)'"

say "Updating checkout to origin/$BRANCH"
remote "cd $REPO && git fetch --prune origin && git checkout -B '$BRANCH' 'origin/$BRANCH' && git log --oneline -1"

say "Building $IMAGE"
remote "cd $REPO && docker build \
  --build-arg SITE_ORIGIN=$ORIGIN \
  --build-arg EXTRA_ALLOWED_ORIGIN=$ORIGIN \
  -t $IMAGE ." 2>&1 | tail -5

say "Running migrations"
remote "cd $STACK && docker compose run --rm --no-deps app npm run migrate" 2>&1 | grep -v '^npm notice' | tail -5

say "Restarting the stack"
remote "cd $STACK && docker compose up -d" 2>&1 | tail -5

# Always, unconditionally: `up -d` will NOT re-run a one-shot service that has
# already completed successfully, so without this the new image's hashed
# /_astro/* assets never reach the volume nginx serves and every page 404s its
# own CSS and JS.
say "Re-populating static assets"
remote "cd $STACK && docker compose run --rm static-init"

verify
