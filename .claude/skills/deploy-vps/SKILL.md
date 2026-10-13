---
name: deploy-vps
description: Use when deploying, updating, redeploying, or rolling back bengaluru-votes on the Hostinger VPS that runs production (bengaluruvotes.opencity.in). Also use when the site serves stale CSS/JS after a deploy, 403s form submissions, or the stack will not come up.
---

# Deploying to the VPS

The deploy tool is `deploy/deploy.sh`, committed in the repo — not in this
skill. It does the whole sequence and verifies it:

```sh
deploy/deploy.sh production v2026.08.14   # build+deploy that annotated tag
deploy/deploy.sh production --rollback    # retag :previous, restart, re-verify
```

Production is the only environment: staging was retired on 2026-09-18 and
removed from the repo on 2026-10-13. Read `deploy/runbook.md` ("Deploying")
for the procedure around the script — what to run before you deploy and the
release-tagging step. `docs/architecture.md` §14 is the design.

## The one thing that breaks silently

`astro.config.mjs` resolves `site` and `security.allowedDomains` once, at
**build** time. An image built with the wrong `SITE_ORIGIN` still serves
every page a perfectly healthy 200 — and rejects every POST with 403. Ward
lookup, login, issue votes and flags all break, and **nothing in
`docker compose ps`, the healthcheck, or the app logs indicates it.**

That is why `deploy.sh`'s verification does a real `POST /api/ward-lookup`
and treats 403 as a hard failure. A deploy that only checks `GET /` is not
verified.

## Quick reference

| Symptom | Cause | Fix |
|---|---|---|
| Forms 403, pages fine | Image built with the wrong `SITE_ORIGIN` | Redeploy via `deploy.sh` — it passes the right one |
| New CSS/JS 404s, or old styling persists | `static-init` did not re-run — `up -d` skips a one-shot that already succeeded | `deploy.sh` always re-runs it; by hand it is `docker compose -p bengaluru-votes-production -f deploy/compose.production.yml run --rm static-init` |
| App container restart-loops | Usually a migration that has not run | `docker compose -p bengaluru-votes-production -f deploy/compose.production.yml run --rm app npm run migrate` |
| `git pull`/checkout refuses | The checkout has local modifications | Reconcile by hand — never `--force` blindly, someone edited that box for a reason |
| Ward lookup says "try again shortly" for every address | Geocoding is unavailable: `GOOGLE_GEOCODING_API_KEY` unset/rejected, or `GEOCODE_DAILY_BUDGET` exhausted | Not a deploy bug in itself. Pincode lookup was removed 2026-08-14, so there is no fallback — check the key and the budget counter |

## Not automated, deliberately

- **Provisioning.** First certs, env files, seeding: `deploy/runbook.md`.
- **Release tagging.** Deciding a commit is production-worthy is a human step (`git tag -a vYYYY.MM.DD`), done after the local checks pass — there is no staging to verify on.
- **Secret rotation.** `/etc/bengaluru-votes/.env.production` holds the only copy of `SESSION_SECRET` and the Postgres password.
