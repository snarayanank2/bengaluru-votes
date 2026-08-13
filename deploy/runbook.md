# Provisioning & operations runbook

Architecture reference: `docs/architecture.md` §14 (Deployment), especially
§14.6 (Provisioning runbook — this document is that runbook, made
operational), §13 (Security), §10 (Jobs, ops, backups). Read those sections
first if anything below seems to assume context.

This is the **committed anchor** for how the box gets built, what secrets it
needs, and the handful of admin actions that only make sense against a live
deployment (OTP cooldown-clear, rollback, restore rehearsal). Exact
commands, not prose — copy-paste, adjusting the bracketed placeholders.

---

## 0. Prerequisites

- A DigitalOcean account with billing set up, API/CLI access (`doctl`) or
  console access.
- Ownership/delegation of the `opencity.in` DNS zone (Oorvani's domain) —
  you need to create two `A`/`AAAA` records under it.
- A DigitalOcean Spaces bucket (BLR1) already created for restic, plus an
  access key pair for it (Spaces -> "Manage Keys").
- The vendor accounts this app talks to, each with an API key ready:
  SendGrid, Twilio, Google Cloud (Geocoding + Programmable Search),
  Anthropic, reCAPTCHA v3, Google Analytics, Sentry, healthchecks.io.
- An SSH key pair you're willing to dedicate to the `deploy` CI user (a
  **separate** key from your personal login key).

---

## 1. Create the Droplet, firewall, and Reserved IP

```sh
# Create the Droplet — Premium AMD, 2 vCPU / 4 GB, BLR1, Ubuntu 24.04 LTS.
doctl compute droplet create bengaluru-votes \
  --region blr1 \
  --size c2-2vcpu-4gb \
  --image ubuntu-24-04-x64 \
  --ssh-keys "<your-personal-ssh-key-fingerprint>" \
  --enable-monitoring \
  --wait

# Reserve a floating IP and assign it to the new Droplet — this is what DNS
# points at, so the Droplet can be rebuilt later without touching DNS.
doctl compute reserved-ip create --region blr1
doctl compute reserved-ip-action assign <reserved-ip> <droplet-id>

# Cloud Firewall: inbound 22, 80, 443 ONLY. No other inbound port, ever —
# Postgres/nginx-cache/metrics never need to be reachable from the internet.
doctl compute firewall create \
  --name bengaluru-votes-fw \
  --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0" \
  --droplet-ids <droplet-id>
```

On the Droplet itself, before anything else, disable root login and
password auth (SSH key-only — architecture §14.5):

```sh
ssh root@<reserved-ip>

# /etc/ssh/sshd_config
sudo sed -i \
  -e 's/^#\?PermitRootLogin .*/PermitRootLogin no/' \
  -e 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config
sudo systemctl restart ssh
```

(Do this from a **non-root** admin account you've already created and
key-authenticated, or you will lock yourself out — create that account
first if `root` was your only access so far.)

---

## 2. DNS

Point both hostnames at the Reserved IP (dependency register §6.8 — under
Oorvani's `opencity.in` zone):

```
bengaluruvotes.opencity.in.          A     <reserved-ip>
staging.bengaluruvotes.opencity.in.  A     <reserved-ip>
```

Verify propagation before continuing (certbot's HTTP-01 challenge in step 5
will fail otherwise):

```sh
dig +short bengaluruvotes.opencity.in
dig +short staging.bengaluruvotes.opencity.in
```

---

## 3. Docker Engine, Compose, and the `deploy` user

```sh
# Docker Engine + Compose plugin (official convenience script).
curl -fsSL https://get.docker.com | sudo sh

# Dedicated CI deploy user — key-only, docker group (architecture §14.4).
# NOTE (§13): docker group membership is root-equivalent on this host — the
# entire "CI holds the keys to the box" accepted risk starts here.
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy

# Install the CI-side public key (generate a DEDICATED keypair for this,
# not your personal one — the private half becomes the DEPLOY_SSH_KEY
# GitHub secret in step 4 below).
sudo -u deploy mkdir -p /home/deploy/.ssh
echo "<deploy-ci-public-key>" | sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys
sudo -u deploy chmod 700 /home/deploy/.ssh
sudo -u deploy chmod 600 /home/deploy/.ssh/authorized_keys
```

---

## 4. Clone the repo and write the `.env` files

**Exact path** — the deploy workflows (Task 62: `deploy-staging.yml`,
`deploy-production.yml`) hardcode `/opt/bengaluru-votes`:

```sh
sudo mkdir -p /opt/bengaluru-votes
sudo chown deploy:deploy /opt/bengaluru-votes
sudo -u deploy git clone git@github.com:snarayanank2/bengaluru-votes.git /opt/bengaluru-votes
```

Write the two env files **outside the repo tree** (architecture §13:
"one `.env` outside the repo, mode 600, referenced by Compose") — e.g.
`/etc/bengaluru-votes/.env.production` and
`/etc/bengaluru-votes/.env.staging` — then point the Compose files at them
via `PROD_ENV_FILE` / `STAGING_ENV_FILE` (see `deploy/compose.production.yml`
/ `compose.staging.yml`, which default to `./.env.production` /
`./.env.staging` for local verification but accept this override):

```sh
sudo mkdir -p /etc/bengaluru-votes
sudo touch /etc/bengaluru-votes/.env.production /etc/bengaluru-votes/.env.staging
sudo chown deploy:deploy /etc/bengaluru-votes/.env.*
sudo chmod 600 /etc/bengaluru-votes/.env.*
```

Then edit each file (as `deploy`, `sudo -u deploy -e /etc/bengaluru-votes/.env.production` or your editor of choice) using the **Required environment
variables** tables below. Export the indirection so Compose picks the files
up by default for that user's sessions (add to `/home/deploy/.bashrc` or a
systemd unit's `Environment=`):

```sh
export PROD_ENV_FILE=/etc/bengaluru-votes/.env.production
export STAGING_ENV_FILE=/etc/bengaluru-votes/.env.staging
```

---

## 5. First certs and first boot

Certbot needs nginx up to answer the HTTP-01 challenge, but nginx needs
certs to start its `443 ssl` server blocks — bootstrap with a throwaway
self-signed pair first, issue real certs against the running stack, then
reload:

```sh
cd /opt/bengaluru-votes

# --- 5a. Throwaway self-signed cert so nginx can start at all -----------
# Uses the `certbot` service's own image (already declares the `certs`
# volume mount in compose.production.yml) rather than guessing the
# Compose-generated volume name directly — `docker compose run` resolves
# that for us.
docker compose -f deploy/compose.production.yml run --rm --entrypoint sh certbot -c '
  set -e
  for host in bengaluruvotes.opencity.in staging.bengaluruvotes.opencity.in; do
    mkdir -p /etc/letsencrypt/live/$host
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout /etc/letsencrypt/live/$host/privkey.pem \
      -out /etc/letsencrypt/live/$host/fullchain.pem \
      -subj "/CN=$host"
  done
'

# --- 5b. Staging basic-auth htpasswd (architecture §14.2 "invisible to
#     the public") — MUST exist as a real FILE before the first
#     `docker compose up` below: compose.production.yml bind-mounts
#     ./nginx/staging.htpasswd read-only, and Docker turns a bind-mount of
#     a not-yet-existing host path into an empty DIRECTORY instead, which
#     then fails nginx's `auth_basic_user_file` load. -------------------
docker run --rm httpd:2-alpine htpasswd -Bbn <tester-username> '<tester-password>' \
  | sudo tee /opt/bengaluru-votes/deploy/nginx/staging.htpasswd

# --- 5c. Bring up production (owns the shared nginx + front network) ----
docker compose -f deploy/compose.production.yml up -d

# --- 5d. Real certs via certbot's webroot plugin, one run per hostname --
docker compose -f deploy/compose.production.yml run --rm certbot \
  certbot certonly --webroot -w /var/www/certbot \
  -d bengaluruvotes.opencity.in --email ops@opencity.in --agree-tos --non-interactive
docker compose -f deploy/compose.production.yml run --rm certbot \
  certbot certonly --webroot -w /var/www/certbot \
  -d staging.bengaluruvotes.opencity.in --email ops@opencity.in --agree-tos --non-interactive

# nginx's own daily reload loop (deploy/compose.production.yml) picks up
# the new certs within 24h; force it immediately instead of waiting:
docker compose -f deploy/compose.production.yml exec nginx nginx -s reload

# --- 5e. Start staging (joins production's front network) --------------
docker compose -f deploy/compose.staging.yml up -d
```

Verify both hostnames serve real certs:

```sh
curl -sI https://bengaluruvotes.opencity.in/healthz
curl -sI -u <tester-username>:<tester-password> https://staging.bengaluruvotes.opencity.in/healthz
```

---

## 6. restic — initialize and rehearse a restore

```sh
# One-time repository init against the DO Spaces bucket (BLR1 — India-
# resident by choice, architecture §13/§14). Run as the `deploy` user with
# the production .env sourced (it carries RESTIC_REPOSITORY/RESTIC_PASSWORD/
# AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY — see the env table below).
set -a; source /etc/bengaluru-votes/.env.production; set +a
restic init

# Rehearse a restore NOW, before you need one for real (dependency register
# §6.9) — do this against a scratch directory, never over the live data dir:
docker compose -f deploy/compose.production.yml run --rm \
  -e DATABASE_URL -e RESTIC_REPOSITORY -e RESTIC_PASSWORD \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  app sh -c '
    restic snapshots &&
    restic dump latest --tag pg_dump > /tmp/rehearsal.dump &&
    pg_restore --list /tmp/rehearsal.dump | head -20
  '
```

Confirm the snapshot list is non-empty and `pg_restore --list` shows real
table entries before moving on. Record the rehearsal date somewhere ops can
find it (this is the "rehearsed restore" the architecture doc references).

---

## 7. Seed the first admin

The root of the authorization chain — every later role grant is an admin
action in `/admin`, itself audit-logged; **role is never inferred from the
authenticating address anywhere else** in this app (architecture §14.6):

```sh
docker compose -f deploy/compose.production.yml run --rm app \
  npm run seed:admin -- <admin-email>
```

(`scripts/seed-admin.ts` upserts a `users` row with `role='admin'` for that
email — idempotent, safe to re-run.)

---

## Required environment variables

Derived by grepping `process.env.` across `src/` and `scripts/backup.sh`
(the jobs container's cron-invoked backup script) — this list is meant to
be exhaustive; if a future change adds a new `process.env.X` read, add it
here in the same PR.

### `.env.production` (both `app`/`jobs` and `postgres`)

| Variable | Required? | Purpose |
|---|---|---|
| `NODE_ENV` | yes | `production` — flips `SESSION_SECRET`'s fail-closed check (throws instead of a dev fallback), among other prod-only behavior. |
| `DATABASE_URL` | yes | `postgres://<user>:<pass>@postgres:5432/<db>` — must match the `POSTGRES_*` values below. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes | Read by the `postgres:16` image itself to initialize, and by its healthcheck (`pg_isready -U ... -d ...`). Keep in sync with `DATABASE_URL`. |
| `SITE_ORIGIN` | yes | `https://bengaluruvotes.opencity.in` — same-origin check in `src/middleware.ts` for unsafe methods, and CSP/absolute-URL building. |
| `SESSION_SECRET` | yes | 32+ random bytes (e.g. `openssl rand -hex 32`). HMACs session cookies and peppers OTP code hashes (`src/lib/session.ts`, `src/lib/otp.ts`). App refuses to start without it when `NODE_ENV=production`. |
| `SENDGRID_API_KEY` | yes (real sends) | Email OTP + campaign sends (`src/lib/send/sendgrid.ts`). |
| `SENDGRID_FROM_EMAIL` | yes (real sends) | Verified sender address for SendGrid. |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | yes (real sends) | Verifies SendGrid's event-webhook signature (`src/pages/api/webhooks/sendgrid.ts`). |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | yes (WhatsApp) | WhatsApp OTP/campaign sends (`src/lib/send/twilio.ts`). |
| `TWILIO_WHATSAPP_FROM` | yes (WhatsApp) | The approved WhatsApp sending number. |
| `TWILIO_OTP_TEMPLATE_SID` | yes (WhatsApp OTP) | Approved WhatsApp OTP Content API template SID (`src/lib/otp.ts`) — unset until WhatsApp onboarding completes (PRD §10); until then WhatsApp OTP requests degrade to `send_failed` by design. |
| `GOOGLE_GEOCODING_API_KEY` | yes (address ward-lookup) | Google Geocoding API. |
| `GEOCODE_DAILY_BUDGET` | recommended | Daily geocode call cap (architecture §13 cost-amplification guard); degrades to pincode lookup when exhausted. |
| `GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_CX` | optional | Programmable Search for news-link suggestions (`jobs/news-suggest.ts`); job no-ops (logs + exits 0) until both are set. |
| `NEWS_QUERY_DAILY_BUDGET` | recommended | Daily query cap for the above. |
| `ANTHROPIC_API_KEY` | yes (Kannada MT/extraction) | Curator-publish-triggered translation/extraction calls; unset means those calls no-op to `'pending'` and `jobs/translate-retry.ts` keeps retrying. |
| `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` | yes (`/partner-with-us`) | reCAPTCHA v3 on the one anonymous write, `POST /api/eoi`. |
| `GA_MEASUREMENT_ID` | optional | Google Analytics — gates the one inline GA script tag in `Base.astro`; unset means GA is simply absent (no error). |
| `OTP_DAILY_SEND_BUDGET` | recommended (default `5000`) | Global daily OTP-send budget across all destinations (architecture §13). |
| `RETENTION_ENABLED` | yes — **must be `false`** | DPDP retention enforcement (`jobs/retention.ts`) ships disabled pending PRD §17 legal sign-off on the retention period. Do not flip to `true` without that sign-off. |
| `RETENTION_PERIOD_DAYS` | only if `RETENTION_ENABLED=true` | Days after results-declared before erasure. |
| `RETENTION_ACTOR_USER_ID` | only if `RETENTION_ENABLED=true` | The admin user id attributed as actor on the erasure job's audit-log rows. |
| `RESTIC_REPOSITORY` | yes (jobs, `scripts/backup.sh`) | e.g. `s3:https://blr1.digitaloceanspaces.com/<bucket>`. |
| `RESTIC_PASSWORD` (or `RESTIC_PASSWORD_FILE`) | yes (jobs) | restic repository encryption password. Custody: dependency register §6.10. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | yes (jobs) | DO Spaces key pair (restic's S3-compatible backend reads the standard AWS_* vars). |
| `HEALTHCHECKS_URL` | yes (jobs) | healthchecks.io ping URL — the nightly backup dead-man's-switch (architecture §10). |
| `SENTRY_DSN` | recommended | Server-side error reporting (`src/lib/logger.ts`) — **unset means Sentry is a clean no-op**, not a broken deploy; set it once the free-tier project exists. |
| `IMAGE_TAG` | supplied by the deploy workflow, not stored in the `.env` file | Pins the exact GHCR image tag pulled (`deploy/compose.production.yml`'s `${IMAGE_TAG:-latest}`); the deploy workflow exports this over SSH per run, it isn't a persisted secret. |

### `.env.staging`

Same shape as production **with two deliberate differences that are the
whole point of the staging guard** (architecture §14.2):

| Variable | Value | Why |
|---|---|---|
| `SENDS_DISABLED` | **`true`** | The campaign runner (`src/lib/send/calendar.ts`) logs instead of sending when this is set — "staging jobs cannot message real people," guard #1. |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_WEBHOOK_PUBLIC_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_OTP_TEMPLATE_SID` | **omit entirely** | Guard #2, independent of guard #1 — even if `SENDS_DISABLED` were ever accidentally unset, there is no real vendor key present to send with. Email OTP on staging will fail closed (`send_failed`); that's expected — staging testers use WhatsApp-disabled/email-disabled paths or a curator-seeded session instead. |

Everything else (`DATABASE_URL` pointing at `postgres-staging`,
`SITE_ORIGIN=https://staging.bengaluruvotes.opencity.in`,
`SESSION_SECRET` — **a different value than production's**,
`RETENTION_ENABLED=false`, `GOOGLE_*`/`ANTHROPIC_API_KEY`/`RECAPTCHA_*` if
you want staging to exercise those integrations against sandbox/test
vendor accounts) follows the same names as the production table. Staging
Postgres is disposable — no restic vars needed for it.

---

## GitHub deploy secrets

Task 62's `deploy-staging.yml` / `deploy-production.yml` SSH into the box
using per-**environment** GitHub secrets (Settings -> Environments):

| Environment | Secret | Value |
|---|---|---|
| `staging` | `DEPLOY_HOST` | the Reserved IP (or `bengaluruvotes.opencity.in`) |
| `staging` | `DEPLOY_USER` | `deploy` |
| `staging` | `DEPLOY_SSH_KEY` | the **private** half of the deploy keypair installed in step 3 |
| `production` | `DEPLOY_HOST` | same host |
| `production` | `DEPLOY_USER` | `deploy` |
| `production` | `DEPLOY_SSH_KEY` | same private key (one Droplet, one `deploy` user — architecture §14.2) |

**Before election week**, enable the architecture §14.4 production
protection rule: repo Settings -> Environments -> `production` -> "Required
reviewers" -> add at least one reviewer. This is off by default (every
`main` push already deploys staging with no gate); it only adds friction to
the `production` environment's release-triggered/`workflow_dispatch` jobs,
which is exactly the surface worth slowing down once real votes/ registrations are flowing.

---

## OTP cooldown-clear (architecture §13)

**Why this exists:** the per-destination OTP send cooldowns (1/minute,
5/hour, a 10-per-day cap — `src/lib/otp.ts`) are themselves a
targeted-DoS vector: anyone who knows a curator's or admin's email/phone
can burn that destination's send budget on purpose, locking the *real*
owner out of getting a **fresh** code (their **existing, unconsumed** code
is untouched and still valid — cooldowns block new sends, never login).
The runbook answer is to clear the cooldown, never to invalidate whatever
code is already sitting in the real owner's inbox.

**Mechanism:** the cooldown counters in `requestOtp` (`src/lib/otp.ts`) are
computed from `otp_codes.created_at` timestamps for that destination inside
trailing 1-minute / 1-hour / 24-hour windows — there is no separate
"cooldown state" table. Clearing it means pushing every row's `created_at`
for that destination outside all three windows **without** touching
`code_hash`, `expires_at`, or `consumed_at` — so any still-valid,
unconsumed code keeps working exactly as it did before (its expiry was
computed from `now + 10 minutes` at creation time, independent of
`created_at`):

```sh
docker compose -f deploy/compose.production.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "UPDATE otp_codes SET created_at = created_at - INTERVAL '25 hours' WHERE destination = '<normalized-destination>';"
```

Use the **normalized** destination exactly as `src/lib/otp.ts#normalizeDestination`
would produce it — trimmed + lowercased for an email address (`trim().toLowerCase()`), trimmed only for a phone number — since that's what's actually stored in `otp_codes.destination`.

Verify the fix by attempting a fresh OTP request for that destination
immediately after — it should return `'sent'` again rather than
`'already_sent'`.

---

## k6 election-day load test (architecture §12; Task 65)

**Why this exists:** one k6 run is the acceptance test for the whole
single-VM sizing decision (architecture §14.6: 2 vCPU / 4 GB) — it proves
the nginx micro-cache holds election-day read volume with p95 < 500 ms,
that legitimate traffic through the CGNAT-sized rate-limit zones (§7) never
sees a 429, and that the app origin renders each unique URL at most once
per cache TTL rather than once per request. The script itself lives at
`tests/load/k6-election-day.js`; read its file-header comment for the full
design rationale (peak-RPS assumption, ward-id space, page mix, the
`X-Cache-Status` dependency).

**WHEN:** run this against **staging**, before election week — not on every
deploy, and never against production (staging is disposable; production
isn't). Re-run it any time the Droplet size, nginx cache config, or rate
limits change.

**Prerequisite — staging currently has no cache to measure.** As shipped,
`deploy/nginx/conf.d/site.conf`'s staging server block deliberately sets
**no** `proxy_cache` on any location ("No cache anywhere on staging — every
request reaches app-staging directly", by design, so staging tests real
app behavior rather than nginx's cache a second time). That means the
script's cache-HIT-ratio assertion (`cache_hit_rate`) and the
cache-absorbs-the-load story behind the p95 assertion **cannot be
validated by pointing `BASE_URL` at staging as configured today** — every
request will MISS (or show an empty `X-Cache-Status`), because there's
nothing to hit. Before the real run, do ONE of:

1. **(Recommended)** Temporarily add the production `/` location's
   `proxy_cache pages; proxy_cache_key "$scheme$host$uri"; proxy_cache_valid
   200 60s;` (plus the matching `ward/[^/]+/issues|data` 5m-TTL location) to
   the staging server block for the duration of the test window, then
   revert — a scoped, reviewed, temporary config change, not a permanent
   fork of staging's behavior.
2. Run this specific k6 test against the **production** hostname during a
   pre-announcement or off-peak window (before public traffic exists, or
   late night), accepting the small residual risk. This script's traffic is
   low-risk even there: `/api/ward-lookup` is only ever called in **pincode
   mode**, which never spends the Google geocode budget (`src/lib/pincode.ts`
   — a pure in-memory lookup), and the script never touches OTP, votes,
   flags, or media endpoints at all.

Either way, `X-Cache-Status` itself is now emitted everywhere the cache
invariant matters — see `deploy/nginx/snippets/security-headers.conf`'s own
comment for why that one-line addition is safe against the Task-60
add_header-inheritance gotcha.

**Install k6 on a separate load-generation machine — NOT the Droplet.**
Generating load from the box under test would measure the generator
competing with the app for the same 2 vCPUs, not the real network path a
Bengaluru citizen's request takes. A laptop or a small cloud VM outside
BLR1 (so the run also reflects real internet latency, not localhost) is
fine:

```sh
# macOS
brew install k6

# Debian/Ubuntu
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

**Run it** (staging basic-auth — see step 5b above — is passed via
`STAGING_USER`/`STAGING_PASS`, or temporarily lift `auth_basic` on the
staging server block for the run and remove it again after):

```sh
k6 run \
  -e BASE_URL=https://staging.bengaluruvotes.opencity.in \
  -e STAGING_USER=<tester-username> \
  -e STAGING_PASS=<tester-password> \
  -e CANDIDATE_SLUGS=<comma-separated-real-slugs-if-any-are-seeded> \
  tests/load/k6-election-day.js
```

Tune `PEAK_CACHED_RPS`, `WARD_LOOKUP_RPS`, `KN_SHARE`, `RAMP_UP`,
`HOLD_AT_PEAK`, `RAMP_DOWN` via the same `-e` flags — see the script's
top-of-file constants for defaults and what each one means.

**Reading the result:** k6 prints a `THRESHOLDS` block at the end. **All
four must show ✓:**

| Threshold | What it proves |
|---|---|
| `http_req_duration{scenario:cached}`: `p(95)<500` | Cached public pages stay fast at election-day volume. |
| `http_req_failed`: `rate<0.01` | No broad breakage under load. |
| `rate_limited_429`: `count==0` | Legitimate ward-lookup/browsing traffic never trips the CGNAT-sized `api` zone (§7). |
| `cache_hit_rate`: `rate>0.9` | The micro-cache — not the app origin — is absorbing the load (requires the staging prerequisite above to be addressed first). |

A ✗ on any threshold fails the acceptance test for the current Droplet
size/config.

**If it fails:** the accepted remediation is a **vertical resize** of the
Droplet (architecture §14.6, §201) — minutes of work via `doctl compute
droplet-action resize <droplet-id> --size <bigger-size> --resize-disk`
(or the DO console) followed by a re-run of this same k6 command. This is
explicitly NOT meant to trigger a re-architecture — the whole point of the
single-VM design's k6 gate is "resize if short, don't redesign." If the
`rate_limited_429` threshold specifically fails (not the RPS/latency ones),
that's a rate-limits.conf zone-sizing question instead (§7) — revisit the
zone rate/burst, not the Droplet size.

---

## Pointers (brief — see the named source for the full procedure)

- **Secret rotation:** custody and rotation cadence — dependency register
  §6.10. Rotating `SESSION_SECRET` invalidates every live session (everyone
  is logged out) and re-peppers future OTP hashes only (old unconsumed
  codes hashed under the old pepper stop verifying — acceptable, they're
  10-minute-lived).
- **Breach response:** DPDP Act notification obligations (Data Protection
  Board + affected data principals) — named owner and procedure at
  dependency register §2.9 (architecture §13).
- **Backup verification:** don't just trust cron — check
  `docker compose -f deploy/compose.production.yml run --rm app sh -c 'restic snapshots --json | jq length'`
  trending upward daily, and that the healthchecks.io check for this job
  hasn't gone red (a missed ping = an ops alert by design, architecture
  §10). Rehearse a full restore (step 6 above) periodically, not just once
  at provisioning time.
- **Rollback:** `gh workflow run deploy-production.yml -f tag=<previous-vYYYY.MM.DD>`
  (or the Actions UI's "Run workflow" with the `tag` input) — pulls and
  restarts an already-built image, **no migration step runs on this path**
  (architecture §14.4/§14.7: migrations are forward-only/backward-compatible,
  so rollback is never a schema operation).
