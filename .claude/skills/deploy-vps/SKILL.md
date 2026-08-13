---
name: deploy-vps
description: Use when deploying, updating, redeploying, or rolling back bengaluru-votes on the interim Hostinger VPS (srv1408795.hstgr.cloud) — the temporary no-TLS preview standing in until the DigitalOcean Droplet exists. Also use when that box serves stale content, 403s form submissions, or shows outdated CSS/JS after a push.
---

# Deploying to the interim VPS

## Overview

The Hostinger VPS at `srv1408795.hstgr.cloud` is a **temporary preview**, not
the deployment story in `docs/architecture.md` §14. It builds the image
locally (there is no registry — architecture §14.3) and serves it over plain HTTP
from a cut-down stack that lives outside the repo.

Run `.claude/skills/deploy-vps/deploy.sh` — it does the whole sequence and
verifies it. This document explains what it does and what to do when a step
fails.

```sh
.claude/skills/deploy-vps/deploy.sh              # deploy origin/main
.claude/skills/deploy-vps/deploy.sh my-branch    # deploy some other branch
.claude/skills/deploy-vps/deploy.sh --rollback   # back to the previous image
```

## The one thing that breaks silently

The build **must** pass both origin args:

```sh
--build-arg SITE_ORIGIN=http://srv1408795.hstgr.cloud
--build-arg EXTRA_ALLOWED_ORIGIN=http://srv1408795.hstgr.cloud
```

`astro.config.mjs` resolves `site` and `security.allowedDomains` once, at
**build** time, against two hard-coded `*.opencity.in` hostnames. An image
built without these args still serves every page on this box with a perfectly
healthy 200 — and rejects every POST with 403. Ward lookup, login, issue
votes and flags all break, and **nothing in `docker compose ps`, the
healthcheck, or the app logs indicates it.**

This is why the script's verification does a real `POST /api/ward-lookup` and
treats 403 as a hard failure. A deploy that only checks `GET /` is not
verified.

## Quick reference

| Symptom | Cause | Fix |
|---|---|---|
| Forms 403, pages fine | Built without the two `--build-arg`s | Rebuild via the script |
| New CSS/JS 404s, or old styling persists | `static-init` didn't re-run — `up -d` skips it once it has completed successfully once | `docker compose run --rm static-init` (the script always does this) |
| App container restart-loops | Usually a migration that hasn't run | `docker compose run --rm --no-deps app npm run migrate` |
| `git pull` refuses | The checkout has local modifications | Reconcile by hand — never `--force` blindly, someone edited that box for a reason |
| Real Bengaluru pincodes say "out of coverage" | `data/pincode-wards.json` is still a 12-row placeholder | Not a deploy bug — run `npm run build-pincode` and commit the result |

## What the script does

1. **Preflight** — SSH reachable, stack dir present, checkout clean.
2. **Tag the current image `:previous`** so `--rollback` has somewhere to go.
3. **Update the checkout** — `git fetch` then `git checkout -B <branch> origin/<branch>`.
4. **Build** with both origin args.
5. **Migrate** — forward-only, so this is safe to run when there's nothing new.
6. **`up -d`**, then **always** re-run `static-init` (see the table above).
7. **Verify** — `/healthz`, `GET /`, an `/_astro/` asset, and the POST check.
   Any failure prints the rollback command and exits non-zero.

## Deliberately not automated

- **No TLS.** Adding certbot here is wasted work; the Droplet is the answer.
- **No `jobs` container.** Its nightly `scripts/backup.sh` needs restic + DO
  Spaces + healthchecks.io credentials this box doesn't have. The database
  here is disposable demo data.
- **No secret rotation.** `/root/vps-deploy/.env` holds the only copy of this
  deployment's `SESSION_SECRET` and Postgres password. Regenerating the
  password while the `pg_data` volume still expects the old one breaks the
  stack.
- **No seeding.** `seed:wards` and `seed:dev` already ran. Re-running
  `seed:dev` needs `-e NODE_ENV=development` to get past its own production
  guard — a knowing override on a throwaway box, never a pattern to copy to
  the Droplet.

## When the Droplet is live

Delete this skill and `/root/vps-deploy` rather than adapting either one. The
real deployment is `deploy/compose.production.yml`, deployed by hand per
`deploy/runbook.md` ("Deploying"). Nothing here should migrate into it — this
stack exists precisely because it is allowed to cut corners the Droplet is
not.

Note that the Droplet flow now also **builds on the box** (architecture
§14.3, revised 2026-08-13), so it and this skill are no longer different in
kind — only in what they're allowed to skip (TLS, the `jobs` container,
secret rotation, seeding). The one thing that transfers is the verification
discipline: the POST check below is mandatory on the Droplet too.
