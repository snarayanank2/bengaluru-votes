#!/usr/bin/env bash
#
# Install a new production env file on the VPS from stdin.
#
#   scripts/ci → node scripts/ci/env-render.ts render | deploy/install-env.sh
#
# The content travels over SSH stdin and is never on a command line (so it is
# not in `ps` output or in shell history). The new file is written beside the
# old one with mode 600 and root ownership, the old file is kept as
# .env.production.prev, and the swap is a single rename.
#
# Env overrides:
#   VPS_SSH_ALIAS   ssh host/alias to deploy to   (default: vps)

set -euo pipefail

SSH_ALIAS=${VPS_SSH_ALIAS:-vps}
TARGET=/etc/bengaluru-votes/.env.production

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"
[ -s "$tmp" ] || { echo "FAILED: refusing to install an empty env file" >&2; exit 1; }

ssh "$SSH_ALIAS" "set -e; umask 077; cat > $TARGET.new; chown root:root $TARGET.new; chmod 600 $TARGET.new; if [ -f $TARGET ]; then cp -p $TARGET $TARGET.prev; fi; mv $TARGET.new $TARGET" < "$tmp"
echo "installed $TARGET ($(wc -l < "$tmp" | tr -d ' ') lines); previous kept as $TARGET.prev"
