#!/usr/bin/env bash
#
# Nightly backup (Task 55; architecture.md §10 "Backups"): pg_dump ->
# restic (encrypted, shipped to off-box S3-compatible storage) -> VERIFY
# the backup actually landed (restic snapshots gained exactly one) -> ping
# a healthchecks.io dead-man's-switch on success. Cron runs this daily
# (deploy/crontab, 02:00). A missed healthchecks.io ping (because this
# script never reached the ping, or never ran at all) is what turns a
# silently wedged backup into an ops alert (architecture §10).
#
# Exits nonzero on ANY failure — pg_dump error, restic error, the
# snapshot count not incrementing, or the ping failing — so cron/
# monitoring notices. Never call this with `|| true`.
#
# Required env vars:
#   DATABASE_URL       - Postgres connection string for pg_dump (same var
#                         every app/job/test in this repo uses).
#   RESTIC_REPOSITORY   - restic repo URL, e.g. s3:https://<endpoint>/<bucket>
#   RESTIC_PASSWORD      - restic repository encryption password (or set
#                          RESTIC_PASSWORD_FILE instead - restic honours
#                          either).
#   AWS_ACCESS_KEY_ID    - Access key for the S3-compatible backup / storage
#   AWS_SECRET_ACCESS_KEY  (restic's s3 backend reads the standard AWS_*
#                          env vars).
#   HEALTHCHECKS_URL     - the healthchecks.io ping URL for this check.
# Optional:
#   BACKUP_STAGING_DIR   - directory for the transient pg_dump file
#                          (default: mktemp's default tmp dir). Removed
#                          after restic ships it either way (architecture
#                          §10: "the dump staging file, removed after
#                          restic ships it").
#
# Requires on PATH: pg_dump, restic, curl, jq.
#
# NOTE (2026-08-13): no backup target has been chosen yet (architecture §10,
# dependency register §6.9), so RESTIC_REPOSITORY is unset in production and
# this script exits 1 nightly. That is intentional — see deploy/crontab.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${HEALTHCHECKS_URL:?HEALTHCHECKS_URL is required}"
if [ -z "${RESTIC_PASSWORD:-}" ] && [ -z "${RESTIC_PASSWORD_FILE:-}" ]; then
  echo "backup.sh: one of RESTIC_PASSWORD or RESTIC_PASSWORD_FILE is required" >&2
  exit 1
fi

export RESTIC_REPOSITORY
# Export only whichever of the two is actually set — exporting an empty
# RESTIC_PASSWORD when only RESTIC_PASSWORD_FILE was provided would give
# restic an (empty) password to prefer over the file.
if [ -n "${RESTIC_PASSWORD:-}" ]; then
  export RESTIC_PASSWORD
fi
if [ -n "${RESTIC_PASSWORD_FILE:-}" ]; then
  export RESTIC_PASSWORD_FILE
fi

STAGING_DIR="${BACKUP_STAGING_DIR:-$(mktemp -d)}"
mkdir -p "$STAGING_DIR"
DUMP_FILE="$STAGING_DIR/bv-$(date -u +%Y%m%dT%H%M%SZ).dump"

cleanup() {
  rm -f "$DUMP_FILE"
}
trap cleanup EXIT

echo "backup.sh: dumping database..."
pg_dump --format=custom --file="$DUMP_FILE" "$DATABASE_URL"

echo "backup.sh: counting existing restic snapshots..."
BEFORE_COUNT=$(restic snapshots --json | jq 'length')

echo "backup.sh: shipping dump to restic repository..."
restic backup --tag pg_dump "$DUMP_FILE"

echo "backup.sh: verifying the snapshot count increased..."
AFTER_COUNT=$(restic snapshots --json | jq 'length')

if [ "$AFTER_COUNT" -le "$BEFORE_COUNT" ]; then
  echo "backup.sh: FAILED verification — restic snapshot count did not increase ($BEFORE_COUNT -> $AFTER_COUNT)" >&2
  exit 1
fi

echo "backup.sh: verified ($BEFORE_COUNT -> $AFTER_COUNT snapshots). Pinging healthchecks.io..."
curl -fsS -m 10 --retry 3 "$HEALTHCHECKS_URL" >/dev/null

echo "backup.sh: done."
