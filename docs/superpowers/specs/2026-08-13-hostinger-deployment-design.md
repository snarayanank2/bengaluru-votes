# Hostinger VPS deployment

Decided 2026-08-13. Supersedes the hosting-provider half of
`docs/architecture.md` §14, whose original design history is
`2026-07-19-digitalocean-deployment-design.md` (not deleted — the reasoning
behind the *shape* of the deployment is still the reasoning we use; only the
provider and the provider-specific ops around it change).

---

## 1. Why

The DigitalOcean Droplet of §14 was never provisioned. A Hostinger VPS
already exists, already runs this application as an interim HTTP-only
preview (`srv1408795.hstgr.cloud`), and is materially larger than the
Droplet that was specified. Standing up a second box on a second provider to
run the same Compose stacks buys nothing.

So: production and staging both move to the existing Hostinger VPS, at

- **production** — `bengaluruvotes.opencity.in`
- **staging** — `staging-bengaluruvotes.opencity.in`

Note the staging hostname is a *flat* name, not a `staging.` subdomain of
production. Nothing in the design depends on the difference: the two
hostnames were always separate certificates and separate nginx `server`
blocks, and the app sets host-only cookies.

## 2. What does not change

This is a provider swap. The runtime architecture is unchanged and is not
reopened here:

- One shared nginx container, owned by the production Compose project,
  terminating TLS for both hostnames and reverse-proxying to the
  per-environment `app` containers (§14.2).
- Two Compose projects sharing only the `gba_front` network. No staging
  service ever joins `gba_back_prod`; that omission *is* the "staging cannot
  reach production Postgres" guarantee.
- Images built on the box from a git checkout, referenced by local tags. No
  registry, nothing pushed or pulled (§14.3).
- Deploys run by hand; nothing fires on push, merge, or release (§14.4).
- Per-stack rollback by retagging `:previous`; never a schema operation,
  because migrations are forward-only and backward-compatible (§14.7).
- The nginx micro-cache and the public-HTML-never-varies-by-session
  invariant (§5).
- `static-init` populating the shared static volume for production, and
  production only — staging serves its own assets through Node.
- The two independent staging send-guards: `SENDS_DISABLED=true` *and* no
  vendor keys present at all (§14.2).

## 3. The box

| | Droplet (planned) | Hostinger VPS (actual) |
|---|---|---|
| Location | BLR1 (Bengaluru) | Mumbai (`AS47583`, India) |
| Compute | 2 vCPU / 4 GB | **4 vCPU / 16 GB** |
| Disk | ~50 GB (`c2-2vcpu-4gb`) | **193 GB** |
| IPv4 | Reserved IP | `76.13.244.198` (fixed to the box) |
| IPv6 | — | `2a02:4780:12:4759::1` (present; public reachability unverified) |
| Firewall | DO Cloud Firewall | `ufw` on the box |
| Backups | DO Spaces (BLR1) | **unresolved** — see §7 |
| Uptime/SSL alerts | DO Uptime | **unresolved** — see §8 |

Two consequences worth stating rather than discovering:

**There is no Reserved-IP equivalent.** DNS points straight at the VPS's own
address, so rebuilding or replacing the box requires a DNS change and a
propagation wait. This is a real regression against the Droplet design,
accepted because the alternative is a floating-IP product Hostinger does not
offer at this tier. Keep the record TTL at 300 during any cutover.

**Headroom improves.** The single-VM sizing question §12's k6 test was meant
to answer is now being asked of a 4 vCPU / 16 GB box rather than a 2 vCPU /
4 GB one. The k6 acceptance test still matters — it validates nginx cache
behaviour and rate-limit zone sizing, not just CPU — but the "vertical
resize before election week" remediation becomes a Hostinger plan upgrade
rather than `doctl compute droplet-action resize`. Builds still compete with
live production traffic on the same box; more cores makes that less acute,
not harmless.

## 4. Checkout layout and branch policy

New. The old runbook assumed a single checkout at `/opt/bengaluru-votes` and
said "check out the intended ref", which leaves the tree at rest holding
whatever was deployed last and makes it possible to build production from a
staging-only branch with no warning.

Two checkouts, one per environment, under the box's `$HOME/src`:

```
/root/src/bengaluru-votes-staging       tracks origin/main
/root/src/bengaluru-votes-production    detached on an annotated tag vYYYY.MM.DD
/etc/bengaluru-votes/.env.staging       mode 600, outside both trees
/etc/bengaluru-votes/.env.production    mode 600, outside both trees
```

- **Staging is `origin/main`.** Deploying staging is fetch, hard-set the
  branch, build, migrate, restart, verify.
- **Production is an immutable tag.** After staging verifies a commit, that
  exact commit is tagged `vYYYY.MM.DD` (`.2` for a second same-day release)
  and pushed; production checks out the tag detached. `git log -1` in either
  tree is then an honest answer to "what is running here", which a single
  shared checkout cannot give.
- **Env files live outside both trees**, referenced through the Compose
  files' existing `STAGING_ENV_FILE` / `PROD_ENV_FILE` indirection, so a
  checkout can be deleted and re-cloned without touching secrets.

**Promotion is a rebuild, never an image copy.** `astro.config.mjs` resolves
`site` and `security.allowedDomains` at *build* time, so the staging and
production images differ even at an identical commit. There is no promoting
a verified staging artifact; production always rebuilds from the tag. This
is also why the two stacks use distinct local tags
(`bengaluru-votes-staging:*` vs `bengaluru-votes:*`) — a shared tag would
mean deploying staging silently swaps the image production restarts onto.

**Deploys run as `root`.** The Droplet design's dedicated key-only `deploy`
user is dropped. It had to be in the `docker` group, which is
root-equivalent on the host, so it was ceremony rather than privilege
separation — the security note in §13 should say that plainly instead of
implying an isolation that never existed. Root SSH stays key-only, password
auth disabled.

## 5. Deploy script

`.claude/skills/deploy-vps/deploy.sh` becomes `deploy/deploy.sh` —
committed, reviewed operational tooling rather than a Claude-only artifact
standing in for a deploy path that did not exist. `.claude/skills/deploy-vps/`
shrinks to a pointer at it plus the failure-mode table.

```sh
deploy/deploy.sh staging                  # build+deploy origin/main to staging
deploy/deploy.sh production v2026.08.14   # build+deploy that tag to production
deploy/deploy.sh <env> --rollback         # retag :previous, restart, re-verify
```

Per-environment sequence, in order:

1. **Preflight** — SSH reachable; the environment's tree and its env file
   exist; the tree is clean. A dirty tree stops the deploy: someone edited
   the box, and clobbering that automatically is never right.
2. **Anchor the rollback** — tag the current image `:previous` *before* the
   build overwrites `:latest`.
3. **Update the tree** — `git fetch --prune [--tags]`, then
   `checkout -B main origin/main` (staging) or `checkout <tag>` (production).
   Print the resulting commit.
4. **Build** with the environment's `SITE_ORIGIN`.
5. **Migrate** — `run --rm <app-service> npm run migrate`. Forward-only and
   idempotent; a failure aborts before anything restarts, leaving the
   running version against the unchanged schema.
6. **`up -d`**.
7. **Production only: re-run `static-init` unconditionally.** `up -d` does
   not re-run a one-shot that has already completed successfully, so
   skipping this serves the previous build's hashed `/_astro/*` filenames
   against new HTML — every page 404s its own CSS and JS.
8. **Verify, including a real POST.** `GET /healthz`, `GET /`, `GET /kn/`,
   an `/_astro/` asset referenced by the homepage HTML (catches a stale
   static volume), and `POST /api/ward-lookup`. A 403 on the POST means the
   image was built without the origin build args: every form on the site is
   dead, and nothing in `docker compose ps`, the healthcheck, or the logs
   reveals it. Staging's checks carry the basic-auth credentials.

Ordering rules the script cannot enforce but the runbook must state:
production comes up before staging on a cold boot (it owns `gba_front`), and
staging deploys before production always, since that is now the only thing
that exercises a migration before it reaches real citizen data.

## 6. Hostname change

`staging.bengaluruvotes.opencity.in` → `staging-bengaluruvotes.opencity.in`
in: `astro.config.mjs` (`security.allowedDomains`), `deploy/compose.staging.yml`
(`SITE_ORIGIN` default), `deploy/nginx/nginx.conf` (header comment),
`deploy/nginx/conf.d/site.conf` (staging `server_name`, the port-80 redirect
block's `server_name`, both cert paths, header comment), `deploy/runbook.md`,
`docs/architecture.md` §14.2, and `tests/load/k6-election-day.js`'s default
`BASE_URL`.

`EXTRA_ALLOWED_ORIGIN` stays. Its comment changes from "the interim
Hostinger VPS standing in until the Droplet is provisioned" to what it now
is: a generic build-time escape hatch for a preview deployment on some other
origin. The mechanism is unchanged and still a no-op when unset.

## 7. Backups — deferred, and this is a launch blocker

The restic target was a DO Spaces bucket in BLR1. With DigitalOcean out of
the picture, no replacement has been chosen. `scripts/backup.sh` is already
provider-neutral (it reads `RESTIC_REPOSITORY` and the standard `AWS_*`
vars); only its DO-specific comments change.

Decisions:

- `RESTIC_REPOSITORY` / `RESTIC_PASSWORD` / `AWS_*` / `HEALTHCHECKS_URL` are
  left unset. Dependency register §6.9 is rewritten from "decided: DO
  Spaces" to unresolved, preserving the India-residency requirement and the
  encrypted-at-rest requirement as constraints on whatever is chosen.
- **The nightly cron entry stays active.** `backup.sh` hard-requires
  `RESTIC_REPOSITORY` and exits 1, so the jobs container logs a failure
  every night at 02:00. That noise is the point: commenting the line out is
  how "we will wire backups later" becomes "we never wired backups". The
  failure is the reminder.
- `architecture.md` §10 must say outright that **production runs with no
  off-box backup until this is resolved**, and that the stated RPO of 24
  hours is currently not met — it is unbounded. §13's data-residency
  paragraph keeps the residency *requirement* while dropping the claim that
  it is satisfied.

This is the one deferral in this design that is genuinely dangerous, and the
docs should read that way rather than reading tidy.

## 8. Monitoring — deferred

DO Uptime provided external liveness checks and, specifically, an
**SSL-expiry alert**. Nothing replaces it yet. Sentry (server-side only) and
healthchecks.io (which only matters once backups exist) are unaffected.

`architecture.md` §10 and dependency register §6.14 drop DigitalOcean Uptime
and record the gap, naming the concrete consequence: certbot renewal failing
silently now surfaces as an outage on expiry day rather than as a warning
weeks earlier. The daily `nginx -s reload` loop still picks up successful
renewals; it is the *failure* path that lost its alarm.

## 9. Vendor keys — open

Still unavailable (SendGrid, Twilio, Google Geocoding/Search, Anthropic,
reCAPTCHA, Sentry). No design change: every one of them already degrades to
a documented no-op rather than an error, and `deploy/runbook.md`'s env table
records what each absence costs. Provisioning proceeds without them;
production behaviour differs accordingly (no email/WhatsApp OTP, no address
ward-lookup, no runtime Kannada MT, no EOI captcha, no error reporting).
`SESSION_SECRET` and the Postgres credentials are generated on the box.

## 10. Provisioning

Phase 2, after the repo changes land. The runbook is rewritten to this
sequence; DigitalOcean-specific steps (`doctl`, Droplet creation, Reserved
IP, Cloud Firewall) are replaced:

1. **DNS** — `A` records for both hostnames at `76.13.244.198`, TTL 300.
   `AAAA` deliberately deferred until after certs issue: Let's Encrypt
   prefers `AAAA` when present and fails issuance if it cannot reach it, and
   the box's IPv6 reachability from the public internet is unverified.
2. **Host hardening** — `ufw` allowing 22/80/443 only; SSH key-only,
   password auth and root password login disabled. Hostinger's panel
   firewall may be used as a second layer, not as a replacement.
3. **Docker Engine + Compose plugin** (already present on this box).
4. **Two clones** per §4, plus the two `.env` files in
   `/etc/bengaluru-votes/` at mode 600, and `PROD_ENV_FILE`/`STAGING_ENV_FILE`
   exported in the shell profile.
5. **`htpasswd`** for the staging basic-auth file, which must exist as a
   *file* before the first `up` — Docker turns a bind-mount of a
   non-existent host path into an empty directory, which fails nginx's
   config load.
6. **Self-signed bootstrap certs** for both hostnames (nginx cannot start
   its `443 ssl` blocks without them), production stack up, **real certs**
   via certbot webroot per hostname, `nginx -s reload`.
7. **Staging stack up** (joins `gba_front`, which now exists).
8. **Seed** — `seed:wards` on both; `seed:admin` on production;
   `seed:dev` on staging only, which requires the explicit
   `NODE_ENV=development` override it guards itself with.
9. **Verify both hostnames with a real POST**, per §5 step 8.
10. **Retire** `/root/vps-deploy`, its containers and volumes, and the
    `srv1408795.hstgr.cloud` preview. The database there is disposable demo
    data; nothing is migrated.

The existing interim stack must keep serving until step 9 passes, so
provisioning runs alongside it rather than replacing it in place — the two
stacks contend for ports 80/443, which is the one hard sequencing
constraint in the cutover.

## 11. Testing

The repo changes are almost entirely documentation, comments, and
configuration strings. What can actually be checked before provisioning:

- `npm run typecheck` and `npm test` — guards against an accidental change
  to `astro.config.mjs` beyond the hostname string.
- `nginx -t` against the rewritten config, via
  `docker run --rm -v .../nginx:/etc/nginx/... nginx:stable nginx -t`.
- `bash -n deploy/deploy.sh`, plus a `--help`/arg-validation path that does
  not touch the box.
- A repo-wide grep proving no `digitalocean|droplet|blr1|doctl|spaces`
  reference survives outside `docs/superpowers/specs/` — the dated design
  documents are history and should keep saying what was decided when.

The real test is step 9 of provisioning: both hostnames serving a 200 on
`GET /` and a non-403 on `POST /api/ward-lookup`.

## 12. Out of scope

Reintroducing CI, a registry, a CDN, a second box, WAL archiving, or any
change to the application itself. Choosing the backup target (§7) and the
monitoring service (§8) — both are recorded as unresolved dependencies, not
solved here.
