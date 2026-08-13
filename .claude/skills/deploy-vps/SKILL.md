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
| Staging verification 401s | `auth_basic` is back on the staging server block — it was removed 2026-08-13 and nothing should be sending a challenge | Check `deploy/nginx/conf.d/site.conf`; staging takes no credentials |
| Staging deploy fails on `X-Robots-Tag` | The header was dropped from the staging server block — likely a new `location` with its own `add_header` (nginx's `add_header` is all-or-nothing per location) | Restore it in `deploy/nginx/conf.d/site.conf`. It is the only thing keeping staging's fictional candidates out of search results |
| `git pull`/checkout refuses | The checkout has local modifications | Reconcile by hand — never `--force` blindly, someone edited that box for a reason |
| Staging stack will not come up | Production stack is down, so `gba_front` does not exist | Bring production up first; staging joins that network as external |
| Real Bengaluru pincodes say "out of coverage" | `data/pincode-wards.json` is still a 12-row placeholder | Not a deploy bug — run `npm run build-pincode` and commit the result |

## Not automated, deliberately

- **Provisioning.** First certs, env files, seeding: `deploy/runbook.md`.
- **Release tagging.** Deciding a commit is production-worthy is a human step (`git tag -a vYYYY.MM.DD`), done after staging verifies.
- **Secret rotation.** `/etc/bengaluru-votes/.env.*` holds the only copy of each environment's `SESSION_SECRET` and Postgres password.
