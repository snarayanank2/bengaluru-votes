#!/bin/sh
# Prepare this checkout's own local Compose stack, so several git worktrees
# (parallel agent sessions) can each run one without colliding.
#
#   scripts/local-instance.sh          # configure only; prints the stack's URL
#   scripts/local-instance.sh --up     # configure, start, create test DBs, seed
#
# Both are idempotent and safe to re-run. `--up` brings the stack up
# (`up --build -d`, which waits for migrations), creates the bv_test and
# bv_e2e databases if missing, and seeds the app database only while it is
# empty: the real wards when there are none, and the fictional demo content
# when there are no candidates. It never re-seeds or truncates a database
# that already has data, so it is safe in the primary checkout too. The
# demo seed also creates one local staff account per role and prints each
# generated password once; they exist only in this stack's database. It then
# waits for the app's health check before printing the URL.
#
# What collides when two checkouts run deploy/compose.local.yml, and what
# this script does about each:
#
#   - the Compose project name (containers, network and the Postgres volume
#     are all keyed on it), the app's host port, Postgres's host port and the
#     `bengaluru-votes:<tag>` image are fixed in compose.local.yml unless the
#     BV_LOCAL_* variables below override them. This script writes them to
#     deploy/.env, which Compose reads automatically for the file next to it,
#     so every documented `docker compose -f deploy/compose.local.yml ...`
#     command works unchanged in any worktree.
#   - deploy/.env.local (vendor keys) is gitignored, so `git worktree add`
#     does not bring it. This script copies it from the primary checkout.
#
# The primary checkout needs none of this and keeps the defaults (project
# bengaluru-votes-local, ports 4321/5433, its existing database volume). Run
# in the primary checkout, configuring only prints those defaults.
#
# deploy/.env holds only BV_LOCAL_* names, which compose.production.yml never
# reads. Ports, once chosen, are kept on later runs so the URL stays stable,
# except an app port outside the Maps key's range (below), which is re-picked.
set -eu

up=false
case "${1:-}" in
  '') ;;
  --up) up=true ;;
  *) echo "usage: $0 [--up]" >&2; exit 2 ;;
esac

root=$(git rev-parse --show-toplevel)
common=$(git rev-parse --path-format=absolute --git-common-dir)
primary=$(dirname "$common")
envfile="$root/deploy/.env"

configure_worktree() {

# 1. Vendor keys from the primary checkout. Copied, not linked, so editing
#    one checkout's keys never changes another's running stack.
if [ ! -f "$root/deploy/.env.local" ]; then
  if [ -f "$primary/deploy/.env.local" ]; then
    cp -p "$primary/deploy/.env.local" "$root/deploy/.env.local"
    chmod 600 "$root/deploy/.env.local"
    echo "Copied deploy/.env.local from the primary checkout."
  else
    # compose.local.yml's env_file is required; an empty file means "no
    # vendor keys", which degrades each one to its documented no-op.
    : > "$root/deploy/.env.local"
    chmod 600 "$root/deploy/.env.local"
    echo "No deploy/.env.local in the primary checkout; created an empty one."
  fi
fi

# 2. Instance identity and ports.
get() { [ -f "$envfile" ] && sed -n "s/^$1=//p" "$envfile" | tail -n 1 || true; }

slug=$(basename "$root" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-\n' '-' | sed 's/^-*//; s/-*$//')
[ -n "$slug" ] || slug=worktree

# Ports already promised to other checkouts (stopped stacks hold no socket,
# so a listening check alone would hand out the same port twice).
taken=$(git worktree list --porcelain | sed -n 's/^worktree //p' | while read -r wt; do
  [ "$wt" = "$root" ] && continue
  if [ -f "$wt/deploy/.env" ]; then
    sed -n 's/^BV_LOCAL_[A-Z0-9_]*PORT=//p' "$wt/deploy/.env"
  fi
done; echo 4321; echo 5433)

in_use() {
  echo "$taken" | grep -qx "$1" && return 0
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}
pick() { p=$1; while in_use "$p"; do p=$((p + 1)); done; echo "$p"; }

# The app port must be one the shared Google Maps browser key accepts as a
# referrer (localhost and 127.0.0.1, ports 4321-4331; docs/gcp.md), or the
# ward map and address autocomplete fail in the browser with no server-side
# error. 4321 is the primary checkout's, so worktrees get 4322-4331. Widen
# the range here only after adding the new ports to the key.
APP_PORT_MIN=4322
APP_PORT_MAX=4331
port=$(get BV_LOCAL_PORT)
if [ -n "$port" ] && { [ "$port" -lt "$APP_PORT_MIN" ] || [ "$port" -gt "$APP_PORT_MAX" ]; }; then
  echo "Stored port $port is outside $APP_PORT_MIN-$APP_PORT_MAX; picking a new one."
  port=
fi
if [ -z "$port" ]; then
  port=$(pick "$APP_PORT_MIN")
  if [ "$port" -gt "$APP_PORT_MAX" ]; then
    echo "No free app port in $APP_PORT_MIN-$APP_PORT_MAX (the ports the Maps key allows)." >&2
    echo "Each worktree with a deploy/.env holds one. Free one: in a finished" >&2
    echo "worktree, run 'docker compose -f deploy/compose.local.yml down -v --rmi local'," >&2
    echo "then 'git worktree remove' it." >&2
    exit 1
  fi
fi
pg_port=$(get BV_LOCAL_PG_PORT); [ -n "$pg_port" ] || pg_port=$(pick 5434)
taken="$taken
$port
$pg_port"
e2e_port=$(get BV_LOCAL_E2E_PORT); [ -n "$e2e_port" ] || e2e_port=$(pick 6322)

cat > "$envfile" <<EOF
# Written by scripts/local-instance.sh for this worktree only (gitignored).
# Compose reads it for deploy/compose.local.yml. Delete it to re-pick ports.
BV_LOCAL_PROJECT=bengaluru-votes-$slug
BV_LOCAL_IMAGE_TAG=$slug
BV_LOCAL_PORT=$port
BV_LOCAL_PG_PORT=$pg_port
# Not read by Compose: the host port for this worktree's Playwright server.
BV_LOCAL_E2E_PORT=$e2e_port
EOF

cat <<EOF
Worktree instance "$slug" (deploy/.env):
  Compose project: bengaluru-votes-$slug
  App:             http://localhost:$port
  Postgres:        postgres://gba:gba_local_dev@localhost:$pg_port/gba
  Playwright:      E2E_PORT=$e2e_port DATABASE_URL=postgres://gba:gba_local_dev@localhost:$pg_port/bv_e2e

Start it with: docker compose -f deploy/compose.local.yml up --build -d
This stack has its own empty database: seed it (header of compose.local.yml)
and create bv_test / bv_e2e in it before running tests: --up does both.
EOF
}

if [ "$root" = "$primary" ]; then
  echo "Primary checkout: defaults apply (project bengaluru-votes-local)."
  echo "  App:      http://localhost:4321"
  echo "  Postgres: postgres://gba:gba_local_dev@localhost:5433/gba"
else
  configure_worktree
fi

$up || exit 0

# 3. Start, create the test databases, seed an empty database.
compose() { docker compose -f "$root/deploy/compose.local.yml" "$@"; }
sql() { compose exec -T postgres psql -U gba -d "$1" -tAc "$2"; }

echo
echo "Starting the stack..."
compose up --build -d

for db in bv_test bv_e2e; do
  if [ "$(sql postgres "SELECT 1 FROM pg_database WHERE datname = '$db'")" = 1 ]; then
    echo "Database $db exists."
  else
    compose exec -T postgres createdb -U gba "$db"
    echo "Created database $db."
  fi
done

run() { compose run --rm --no-deps "$@"; }
if [ "$(sql gba 'SELECT count(*) FROM wards')" = 0 ]; then
  echo "Seeding the real wards..."
  run app npm run seed:wards
else
  echo "Wards already seeded."
fi
if [ "$(sql gba 'SELECT count(*) FROM candidates')" = 0 ]; then
  echo "Seeding fictional demo content..."
  # seed:dev refuses under NODE_ENV=production; this override is safe on the
  # local stack only (compose.local.yml header).
  run -e NODE_ENV=development app npm run seed:dev
else
  echo "Candidates already present; demo content not re-seeded."
fi

port=$( [ -f "$envfile" ] && sed -n 's/^BV_LOCAL_PORT=//p' "$envfile" | tail -n 1 || true)
url="http://localhost:${port:-4321}"
i=0
until curl -fs -o /dev/null "$url/healthz"; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "The app did not become healthy at $url. Recent app logs:" >&2
    compose logs --tail 30 app >&2
    exit 1
  fi
  sleep 2
done
echo
echo "Ready: $url"
