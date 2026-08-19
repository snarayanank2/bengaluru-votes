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

- SSH access to the Hostinger VPS as `root` (key-only). `76.13.244.198`;
  the box is `srv1408795.hstgr.cloud` until DNS is cut over.
- Ownership/delegation of the `opencity.in` DNS zone (Oorvani's domain) —
  you need to create two `A` records under it.
- **A GitHub credential ON THE BOX, before step 4 below.** §4's
  `git clone git@github.com:…` runs from a fresh hardened root shell that
  has never talked to GitHub — with nothing set up it fails on `Permission
  denied (publickey)`, or hangs/aborts on GitHub's unaccepted host key.
  Before step 4:

  ```sh
  ssh-keygen -t ed25519 -C "bengaluru-votes-vps" -f ~/.ssh/id_ed25519 -N ''
  cat ~/.ssh/id_ed25519.pub   # register this as a GitHub deploy key
  ssh-keyscan github.com >> ~/.ssh/known_hosts
  ```

  Register the public key as a **read-only deploy key** on the
  `snarayanank2/bengaluru-votes` repo (repo Settings → Deploy keys → Add
  deploy key — do not add write access, nothing here pushes). This same key
  is what `deploy/deploy.sh`'s `git fetch` needs on every future deploy, so
  it must persist on the box, not just exist long enough for step 4's
  `clone`.
- **Off-box backup storage: UNRESOLVED** (dependency register §6.9;
  `docs/architecture.md` §10). There is no restic target, so step 6 below
  cannot be completed and the platform runs with no off-box backup. This is
  a launch blocker, not a nice-to-have.
- The vendor accounts this app talks to — SendGrid, Twilio, Google Cloud
  (Geocoding + Programmable Search), Anthropic, reCAPTCHA v3, Google
  Analytics, Sentry, healthchecks.io. **None are available as of
  2026-08-13.** Each absence degrades to a documented no-op rather than an
  error (see the env table below for what each one costs), so provisioning
  proceeds without them.

---

## 1. Harden the host

The prior design used a DigitalOcean Cloud Firewall; on this box the
committed anchor is `ufw` (`docs/architecture.md` §14.5). Inbound 22, 80,
443 only — Postgres and the app port are never reachable from the internet.

```sh
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
```

`ufw` and Docker's published ports interact badly in general — Docker writes
its own iptables rules that bypass ufw's INPUT chain. That is acceptable
here precisely because the only published ports are 80 and 443, which ufw
allows anyway. Do not publish any other port expecting ufw to hide it.

SSH: key-only, no passwords, no root password login.

```sh
sed -i \
  -e 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' \
  -e 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config
```

**Check the drop-in directory too — the `sed` above alone is likely not
enough.** Ubuntu cloud images ship
`/etc/ssh/sshd_config.d/50-cloud-init.conf` containing
`PasswordAuthentication yes`, and the `Include` directive that pulls in
`sshd_config.d/*.conf` sits near the top of `sshd_config`, where sshd's
first-obtained-value-wins parsing means that drop-in overrides the setting
you just changed in the main file. Check it and fix it there too:

```sh
grep -ri passwordauthentication /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config.d/50-cloud-init.conf 2>/dev/null || true
systemctl restart ssh
```

Verify what sshd will actually enforce — not just what you edited — with
its own effective-config dump, since that's the only thing immune to both
files disagreeing:

```sh
sshd -T | grep -E '^(permitrootlogin|passwordauthentication)'
# expect: permitrootlogin prohibit-password
#         passwordauthentication no
```

Still confirm you can open a **second** session before closing the first —
`sshd -T` proves the setting took effect, not that your key-based access
survives it; that guards against lockout, which the config check alone does
not.

---

## 2. DNS

Point both hostnames at the VPS (dependency register §6.8 — under Oorvani's
`opencity.in` zone):

```
bengaluruvotes.opencity.in.          300  IN  A  76.13.244.198
staging-bengaluruvotes.opencity.in.  300  IN  A  76.13.244.198
```

**`A` only, deliberately.** The box has a global IPv6 address
(`2a02:4780:12:4759::1`) but its public reachability is unverified, and
Let's Encrypt *prefers* `AAAA` when one exists and fails issuance outright
if it cannot reach it — publishing an unverified `AAAA` is the easiest way
to make certbot fail in a way that reads as a DNS problem. Add `AAAA` after
step 5 below succeeds and IPv6 is confirmed working from outside.

TTL 300 during cutover; raise to 3600 once stable. Verify propagation before
step 5 below (certbot's HTTP-01 challenge fails otherwise):

```sh
dig +short bengaluruvotes.opencity.in
dig +short staging-bengaluruvotes.opencity.in
```

---

## 3. Docker Engine and Compose

```sh
curl -fsSL https://get.docker.com | sh
docker compose version
```

Deploys run as `root` (`docs/architecture.md` §14.4). The prior design's
dedicated `deploy` user is dropped: it had to be in the `docker` group,
which is root-equivalent on the host, so it read as privilege separation
while providing none. Architecture §13 records that trade.

---

## 4. Two checkouts and the `.env` files

One tree per environment (`docs/architecture.md` §14.3). These are not just
a source of Compose files — since images are built on the box, each tree is
what its stack builds *from*, so the ref it sits on is the version that
ships.

At first provisioning there is no release tag yet — leave the production
tree on `main` too, same as staging. `deploy/deploy.sh production
<vYYYY.MM.DD>` checks out the real tag (detached) at the first actual
production deploy (see "Deploying" below and the plan's Task 7 step 3); this
step just needs a working tree to build from for §5's first boot.

```sh
mkdir -p /root/src
git clone git@github.com:snarayanank2/bengaluru-votes.git /root/src/bengaluru-votes-staging
git clone git@github.com:snarayanank2/bengaluru-votes.git /root/src/bengaluru-votes-production

cd /root/src/bengaluru-votes-staging    && git checkout main
cd /root/src/bengaluru-votes-production && git checkout main
```

Env files go **outside both trees**, mode 600 (`docs/architecture.md` §13),
so a checkout can be deleted and re-cloned without touching secrets:

```sh
mkdir -p /etc/bengaluru-votes
touch /etc/bengaluru-votes/.env.production /etc/bengaluru-votes/.env.staging
chmod 600 /etc/bengaluru-votes/.env.*
```

Fill each in from the **Required environment variables** tables below.
Generate the secrets on the box:

```sh
openssl rand -hex 32     # SESSION_SECRET — a DIFFERENT value per environment
openssl rand -hex 24     # POSTGRES_PASSWORD — likewise
```

The Compose files read these paths through `PROD_ENV_FILE` /
`STAGING_ENV_FILE`. `deploy/deploy.sh` exports them inline on every remote
command — deliberately, because `ssh host 'cmd'` is a non-interactive shell
that does not source `~/.bashrc`, so a profile export would silently not
apply and Compose would fall back to a `./.env.<env>` that does not exist.
When running Compose by hand, export them yourself:

```sh
export PROD_ENV_FILE=/etc/bengaluru-votes/.env.production
export STAGING_ENV_FILE=/etc/bengaluru-votes/.env.staging
```

---

## 5. First certs and first boot

Certbot needs nginx up to answer the HTTP-01 challenge, but nginx needs
certs to start its `443 ssl` server blocks — bootstrap with a throwaway
self-signed pair first, issue real certs against the running stack, then
reload.

All commands below run from the **production** checkout, which owns nginx,
certbot, and the `gba_front` network.

```sh
cd /root/src/bengaluru-votes-production
export PROD_ENV_FILE=/etc/bengaluru-votes/.env.production
COMPOSE="docker compose -p bengaluru-votes-production -f deploy/compose.production.yml"

# --- 5a. Throwaway self-signed certs so nginx can start at all ----------
$COMPOSE run --rm --entrypoint sh certbot -c '
  set -e
  for host in bengaluruvotes.opencity.in staging-bengaluruvotes.opencity.in; do
    mkdir -p /etc/letsencrypt/live/$host
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout /etc/letsencrypt/live/$host/privkey.pem \
      -out /etc/letsencrypt/live/$host/fullchain.pem \
      -subj "/CN=$host"
  done
'

# --- 5b. (removed) Staging basic-auth htpasswd -------------------------
# Nothing to do here any more. Staging basic auth was removed on 2026-08-13
# (architecture §14.2): staging is reachable by anyone with the URL, and
# `X-Robots-Tag: noindex` is the only thing keeping it out of search results.
# deploy/deploy.sh asserts that header on every staging deploy.
#
# If you ever restore it, all three of these move together or nginx will not
# start: the `auth_basic` + `auth_basic_user_file` directives in
# deploy/nginx/conf.d/site.conf, the htpasswd bind mount in
# deploy/compose.production.yml, and generating the file here. Two traps that
# cost real time in the 2026-08-13 cutover and would cost it again:
#
#   - It must exist as a real FILE before the first `up`. Docker turns a
#     bind-mount of a non-existent host path into an empty DIRECTORY, which
#     then fails nginx's `auth_basic_user_file` load.
#   - It must be WORLD-READABLE (644). nginx's master starts as root but its
#     WORKERS drop to the unprivileged `nginx` user (nginx.conf's `user`
#     directive), and the worker is what opens the file per request. Mode 600
#     gives every staging request a 500 with `open() ".../staging.htpasswd"
#     failed (13: Permission denied)` in the nginx error log and nothing
#     wrong anywhere else — app-staging stays healthy, so it reads as an app
#     fault. 644 is not a leak: the file holds a bcrypt hash, mounted ro.
#
#   docker run --rm httpd:2-alpine htpasswd -Bbn <user> '<pass>' \
#     > /root/src/bengaluru-votes-production/deploy/nginx/staging.htpasswd
#   chmod 644 /root/src/bengaluru-votes-production/deploy/nginx/staging.htpasswd

# --- Port contention with the interim stack, MUST run before 5c --------
# The old /root/vps-deploy stack also binds 80. `up -d` below fails to bind
# it — or silently steals it — if that stack is still running, so stop it
# now, immediately before 5c. (Run in a subshell so this doesn't change your
# cwd out of the production checkout.) Do NOT remove its volumes yet — do
# not run anything with `-v` here — that stack stays available as the
# rollback until §5's verification below and §8 both hold; §8 retires it.
( cd /root/vps-deploy && docker compose down )

# --- 5c. Production up (owns the shared nginx + gba_front) --------------
$COMPOSE up -d

# --- 5d(i). Remove the 5a bootstrap stubs before issuing real certs ----
# certbot refuses to create a lineage when live/<host> already exists and is
# non-empty (CertStorageError: live directory exists) — or worse, silently
# creates a `<host>-0001` lineage that nginx never reads, so the site keeps
# serving the self-signed stub forever with no error anywhere. nginx keeps
# serving the already-loaded (self-signed) cert out of the `certs` volume
# until the next `nginx -s reload`, so removing these files mid-flight is
# safe — nginx has nothing to lose access to in between.
$COMPOSE run --rm --entrypoint sh certbot -c '
  set -e
  for h in bengaluruvotes.opencity.in staging-bengaluruvotes.opencity.in; do
    rm -rf /etc/letsencrypt/live/$h /etc/letsencrypt/archive/$h /etc/letsencrypt/renewal/$h.conf
  done
'

# --- 5d(ii). Real certs, one certbot run per hostname -------------------
# `--entrypoint certbot` is REQUIRED here, not cosmetic: the `certbot`
# service's own entrypoint is `['/bin/sh', '-c']` (see compose.production.yml
# — it's how the renewal loop's `command:` runs), and `docker compose run
# SERVICE CMD…` replaces `command` but never `entrypoint`. Without this flag
# the invocation actually run is `/bin/sh -c certbot`, with `certonly`,
# `--webroot`, `-d <host>` and everything else silently bound to `$0`, `$1`…
# — i.e. bare `certbot` with none of the arguments below, and no error. §5a
# already gets this right with `--entrypoint sh`; match that pattern.
$COMPOSE run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d bengaluruvotes.opencity.in --email ops@opencity.in --agree-tos --non-interactive
$COMPOSE run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d staging-bengaluruvotes.opencity.in --email ops@opencity.in --agree-tos --non-interactive

$COMPOSE exec nginx nginx -s reload

# --- 5e. Staging up (joins gba_front, which now exists) ----------------
cd /root/src/bengaluru-votes-staging
export STAGING_ENV_FILE=/etc/bengaluru-votes/.env.staging
docker compose -p bengaluru-votes-staging -f deploy/compose.staging.yml up -d
```

The interim stack's volumes stay in place until **both**
`https://bengaluruvotes.opencity.in` **and**
`https://staging-bengaluruvotes.opencity.in` have served a `200` on `GET /`
and a non-`403` on `POST /api/ward-lookup` — the same checks
`deploy/deploy.sh` runs (see "Deploying" below). Step 8 below retires it once
that gate holds.

Verify both hostnames serve real certs:

```sh
curl -fsSI https://bengaluruvotes.opencity.in/healthz
curl -fsSI -u <tester-username>:<tester-password> https://staging-bengaluruvotes.opencity.in/healthz
```

---

## 6. restic — BLOCKED

**No off-box backup target has been chosen** (dependency register §6.9;
`docs/architecture.md` §10). `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `HEALTHCHECKS_URL` are
therefore unset in both `.env` files, and `scripts/backup.sh` fails its
required-variable check every night at 02:00 in the `jobs` container's log.

That nightly failure is intentional and should stay noisy until the target
exists. **Production is running with no off-box backup**: the stated 24-hour
RPO is not merely missed, it is unbounded.

Once a target is chosen, the remaining work is exactly:

```sh
set -a; source /etc/bengaluru-votes/.env.production; set +a
restic init

# Rehearse a restore NOW, before you need one — against a scratch directory,
# never over the live data dir:
docker compose -p bengaluru-votes-production -f deploy/compose.production.yml run --rm \
  -e DATABASE_URL -e RESTIC_REPOSITORY -e RESTIC_PASSWORD \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  app sh -c '
    restic snapshots &&
    restic dump latest --tag pg_dump > /tmp/rehearsal.dump &&
    pg_restore --list /tmp/rehearsal.dump | head -20
  '
```

Confirm the snapshot list is non-empty and `pg_restore --list` shows real
table entries. Record the rehearsal date where ops can find it.

---

## 7. Migrate, then seed

**Required — do not skip.** Neither compose file has a `migrate` service and
the image's CMD does not migrate on startup (that only happens as an
explicit deploy step, §14.7), so after §5's `up -d` both databases have no
schema at all. Skipping this step means `seed:wards` below fails immediately
on a missing relation.

```sh
# Production
cd /root/src/bengaluru-votes-production
export PROD_ENV_FILE=/etc/bengaluru-votes/.env.production
COMPOSE="docker compose -p bengaluru-votes-production -f deploy/compose.production.yml"
$COMPOSE run --rm app npm run migrate

# Staging
cd /root/src/bengaluru-votes-staging
export STAGING_ENV_FILE=/etc/bengaluru-votes/.env.staging
COMPOSE_S="docker compose -p bengaluru-votes-staging -f deploy/compose.staging.yml"
$COMPOSE_S run --rm app-staging npm run migrate
```

Wards first — everything else depends on them.

```sh
# Production: the real 369 wards, then the first admin.
cd /root/src/bengaluru-votes-production
export PROD_ENV_FILE=/etc/bengaluru-votes/.env.production
COMPOSE="docker compose -p bengaluru-votes-production -f deploy/compose.production.yml"
$COMPOSE run --rm app npm run seed:wards
$COMPOSE run --rm app npm run seed:admin -- <admin-email>

# Staging: wards, plus the deliberately-fictional demo content. seed:dev
# refuses to run under NODE_ENV=production and staging's .env sets exactly
# that, so the override is explicit and knowing — never copy this to
# production.
cd /root/src/bengaluru-votes-staging
export STAGING_ENV_FILE=/etc/bengaluru-votes/.env.staging
COMPOSE_S="docker compose -p bengaluru-votes-staging -f deploy/compose.staging.yml"
$COMPOSE_S run --rm app-staging npm run seed:wards
$COMPOSE_S run --rm -e NODE_ENV=development app-staging npm run seed:dev
```

`scripts/seed-admin.ts` upserts a `users` row with `role='admin'` for that
email — idempotent, safe to re-run. It is the root of the authorization
chain: every later role grant is an admin action in `/admin`, itself
audit-logged, and role is never inferred from the authenticating address
anywhere else in this app.

---

## 8. Retire the interim stack

**Only after** both `https://bengaluruvotes.opencity.in` **and**
`https://staging-bengaluruvotes.opencity.in` have served a `200` on `GET /`
and a non-`403` on `POST /api/ward-lookup` — the same condition step 5
above holds you to before touching the interim stack's volumes, and what
`deploy/deploy.sh` verifies on every deploy. This closes out architecture
§14.6 step 8 ("Verify both hostnames … then retire the interim preview
stack").

**Guard first — `-v` is exactly the command that must never resolve to the
production project.** Before running it, confirm you are actually in
`/root/vps-deploy` and not, say, a production checkout you `cd`'d into
earlier in the session:

```sh
cd /root/vps-deploy
docker compose config --format json | jq -r .name
docker volume ls | grep bengaluru
```

**If the project name printed is `bengaluru-votes-production` (or you see
`bengaluru-votes-production_pg_data_prod` in the volume list), STOP.** Do
not run the command below. `-v` against the production project would
destroy the production Postgres volume, and per §6 there is currently no
off-box backup to restore it from — this would be unrecoverable data loss
on a live election platform. The name printed here must be the interim
stack's own project (whatever `/root/vps-deploy`'s compose file calls
itself), never `bengaluru-votes-production` or `bengaluru-votes-staging`.

```sh
docker compose down -v
```

`-v` destroys the interim stack's Postgres volume. That's fine — it only
ever held disposable demo data — but the command is still the point of no
return: once it runs, `/root/vps-deploy` is no longer available as the
rollback for this cutover. Do not run it before the gate above holds.

Then remove what it leaves behind:

```sh
rm -rf /root/vps-deploy
rm -rf /root/src/bengaluru-votes     # the old single checkout — superseded
                                      # by the two per-environment trees
                                      # (step 4 above)
docker image rm bengaluru-votes:vps
```

**Deliberately not `bengaluru-votes:previous`.** That tag is the interim
stack's own leftover *only* if nothing has deployed production since
provisioning — the first `deploy/deploy.sh production` run retags whatever
image is currently `:latest` (by then the new stack's own build) as
`:previous`, and from that point on the tag means the new stack's rollback
anchor, not the interim stack's. Telling the two apart reliably costs more
than it saves — one small leftover image is nothing on a 193 GB disk, so
leave it. **Never `docker image prune` here either, or casually at any
later point** — `:previous` is the only rollback anchor either new stack
has (there is no registry — architecture §14.3), and pruning "unused"
images is exactly how a rollback stops being possible.

**Leave the new stacks' running images alone too.** Do not touch
`bengaluru-votes:latest` or `bengaluru-votes-staging:latest` — production
and staging are running those right now.

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
| `GOOGLE_GEOCODING_API_KEY` | yes — the ONLY path to a ward | Google Geocoding API. Pincode lookup was removed 2026-08-14, so this is the sole path from an address to a ward, with no fallback. Unset (or Google unreachable) means every lookup returns `unavailable`. |
| `GEOCODE_DAILY_BUDGET` | recommended | Daily geocode call cap (architecture §13 cost-amplification guard). **Exhausting it now takes ward lookup DOWN** — pincode lookup was removed 2026-08-14 and there is no fallback left. Default 2000/day. |
| `ELECTORAL_API_ORIGIN` | optional | Origin of the BBMP electoral API behind booth-lookup-by-EPIC (`src/lib/electoral-api.ts`). Defaults to `https://electoralapi.bbmpgov.in`. **There is no key** — it is a public, unauthenticated endpoint, so there is nothing to omit and no "unset degrades to a no-op" case here; override it only to point staging or a test at something else. |
| `ELECTORAL_API_TIMEOUT_MS` | optional | How long to wait on that upstream before giving up. Default 5000. A timeout renders as "try again shortly", never as "voter ID not found" — the two must not be confused (`src/i18n/en.json`, `findBooth.result.unavailable`). |
| `EPIC_DAILY_BUDGET` | recommended | Daily cap on calls to that upstream, via the shared budget counter. **Not a spend limit** — the endpoint is free; this exists so a script pointed at `/api/booth-lookup` cannot use us to hammer a public government service. Global rather than per-IP, so set it well above real citizen traffic: exhausting it takes booth lookup down for everyone until the next UTC day, and the page then points at the official EC finder. Default 5000/day. |
| `GOOGLE_MAPS_BROWSER_KEY` | yes (ward map + address autocomplete) | Referrer-restricted browser key, shared by the ward boundary map (`src/islands/WardMap.ts`) and Places Autocomplete on the ward-lookup form (`src/islands/WardLookup.ts`), both gated through `src/lib/maps-config.ts`'s `mapsConfig().enabled`. Unset means both are absent; the ward page and the ward-lookup input render their server-rendered fallback markup, which is identical whether or not JS runs. `docs/gcp.md` §3. |
| `GOOGLE_MAPS_MAP_ID` | yes (ward map — required by the `enabled` gate) | Cloud map style (`docs/gcp.md` §4) — required, not just recommended: it's the only place in code that enforces the neutrality rule (no party-affiliated look, no red markers). Unset means `mapsConfig().enabled` is false, so the map does not render at all; the ward page renders its server-rendered fallback markup instead of an unstyled stock basemap. |
| `MAPS_ENABLED` | yes to show maps | Kill switch (`src/lib/maps-config.ts`) — must be exactly `true`, and both `GOOGLE_MAPS_BROWSER_KEY` and `GOOGLE_MAPS_MAP_ID` must also be non-empty, for the map to render. Sheds client-side map spend without a rebuild when a budget alert fires. |
| `GOOGLE_SEARCH_API_KEY` / `GOOGLE_SEARCH_CX` | optional | Programmable Search for news-link suggestions (`jobs/news-suggest.ts`); job no-ops (logs + exits 0) until both are set. |
| `NEWS_QUERY_DAILY_BUDGET` | recommended | Daily query cap for the above. |
| `ANTHROPIC_API_KEY` | yes (Kannada MT/extraction) | Curator-publish-triggered translation/extraction calls; unset means those calls no-op to `'pending'` and `jobs/translate-retry.ts` keeps retrying. |
| `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` | yes (`/partner-with-us`) | reCAPTCHA v3 on the one anonymous write, `POST /api/eoi`. |
| `GA_MEASUREMENT_ID` | production only — `G-PZQJ1ZSCN0` | Google Analytics — gates the one inline GA script tag in `Base.astro`; unset means GA is simply absent (no error). Set on production 2026-08-14; **deliberately omitted from `.env.staging`** so staging traffic never enters the property. The id is public (it ships in the HTML), so it lives here rather than in a credential store. Read at request time — changing it needs a container recreate, not a rebuild. |
| `OTP_DAILY_SEND_BUDGET` | recommended (default `5000`) | Global daily OTP-send budget across all destinations (architecture §13). |
| `OTP_TEST_SINK` | **must NOT be set** | `src/lib/otp.ts` — when exactly `'true'`, writes every plaintext OTP code to a `otp_test_codes` table so the Playwright e2e suite can read codes without in-process access. The source comment is explicit: this must NEVER be set in production or staging. Leave unset in both `.env` files. |
| `RETENTION_ENABLED` | yes — **must be `false`** | DPDP retention enforcement (`jobs/retention.ts`) ships disabled pending PRD §17 legal sign-off on the retention period. Do not flip to `true` without that sign-off. |
| `RETENTION_PERIOD_DAYS` | only if `RETENTION_ENABLED=true` | Days after results-declared before erasure. |
| `RETENTION_ACTOR_USER_ID` | only if `RETENTION_ENABLED=true` | The admin user id attributed as actor on the erasure job's audit-log rows. |
| `RESTIC_REPOSITORY` | **blocked** | No target chosen — dependency register §6.9. Leave unset; scripts/backup.sh fails loudly nightly until it exists. |
| `RESTIC_PASSWORD` (or `RESTIC_PASSWORD_FILE`) | yes (jobs) | restic repository encryption password. Unset until dependency register §6.9 resolves. Custody: dependency register §6.10. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | yes (jobs) | Credentials for whatever S3-compatible backup storage dependency register §6.9 settles on (restic's s3 backend reads the standard AWS_* vars). Unset today. |
| `HEALTHCHECKS_URL` | yes (jobs) | healthchecks.io ping URL — the nightly backup dead-man's-switch. Only meaningful once backups exist (dependency register §6.9). |
| `SENTRY_DSN` | recommended | Server-side error reporting (`src/lib/logger.ts`) — **unset means Sentry is a clean no-op**, not a broken deploy; set it once the free-tier project exists. |
| `IMAGE_TAG` | optional, not stored in the `.env` file | Selects which **local** image tag the stack runs (`deploy/compose.production.yml`'s `${IMAGE_TAG:-latest}`). Left unset for a normal deploy; it exists so a rollback can point the stack at `:previous` without rebuilding. |

### `.env.staging`

Same shape as production **with two deliberate differences that are the
whole point of the staging guard** (architecture §14.2):

| Variable | Value | Why |
|---|---|---|
| `SENDS_DISABLED` | **`true`** | The campaign runner (`src/lib/send/calendar.ts`) logs instead of sending when this is set — "staging jobs cannot message real people," guard #1. |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_WEBHOOK_PUBLIC_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_OTP_TEMPLATE_SID` | **omit entirely** | Guard #2, independent of guard #1 — even if `SENDS_DISABLED` were ever accidentally unset, there is no real vendor key present to send with. Email OTP on staging will fail closed (`send_failed`); that's expected — staging testers use WhatsApp-disabled/email-disabled paths or a curator-seeded session instead. |

Everything else (`DATABASE_URL` pointing at `postgres-staging`,
`SITE_ORIGIN=https://staging-bengaluruvotes.opencity.in`,
`SESSION_SECRET` — **a different value than production's**,
`RETENTION_ENABLED=false`, `GOOGLE_*`/`ANTHROPIC_API_KEY`/`RECAPTCHA_*` if
you want staging to exercise those integrations against sandbox/test
vendor accounts) follows the same names as the production table. Staging
Postgres is disposable — no restic vars needed for it.

---

## Deploying

Deploys are **manual** (`docs/architecture.md` §14.4). There is no CI, no
registry, and nothing that fires on push, merge or release. Images are built
on the box from the per-environment checkouts (architecture §14.3).

**Run the checks first — nothing else will.** On your machine, not the box:

```sh
npm run translate -- --check   # bilingual completeness (architecture §9)
npm run typecheck
npm test
```

**Accepted translation-check exception (2026-08-19):**
`content/pages/kn/privacy.md` is a known stale target because its location-
privacy paragraph was translated without an available `ANTHROPIC_API_KEY`.
Do not hand-write its `sourceHash`; that would forge translation provenance.

A deploy may proceed when `npm run translate -- --check` lists **only** this
file. Any other missing or stale target still blocks the deploy. Once a real
key is available, regenerate and review the privacy translation, commit it,
and remove this exception.

### Staging

Staging is whatever is on `main`. Push, then:

```sh
git push origin main
deploy/deploy.sh staging
```

Then **look at it in a browser**. That is the point of staging. No credentials
— staging basic auth was removed 2026-08-13 (architecture §14.2); the URL is
all anyone needs, testers and strangers alike.

### Production

Tag the exact commit staging verified, then deploy that tag:

```sh
git tag -a v2026.08.14 -m "release" origin/main
git push origin v2026.08.14
deploy/deploy.sh production v2026.08.14
```

**Deploy staging first, always.** No pipeline enforces the order any more,
and staging-before-production is the only thing that exercises a migration
before it touches real citizen data (architecture §14.7).

### The one exception: changes under `deploy/nginx/`

**nginx config changes take effect on a PRODUCTION deploy, including the ones
that only affect staging.** The single nginx container is owned by the
production stack and bind-mounts its config from the *production* checkout
(`compose.production.yml`), so a staging deploy updates the staging checkout
and changes nothing about how any request is routed or authorized. Deploying
staging first here does nothing at all; worse, a staging deploy can fail its
own verification because the nginx behaviour it asserts has not shipped yet.

For an nginx-only change the order inverts: **production first, then
staging.** And because both hostnames are behind that one container, a config
error takes production down with it — validate before you deploy, from the
box, against the real certs and network:

```sh
# on the box, after the production checkout is on the new ref
docker compose -p bengaluru-votes-production -f deploy/compose.production.yml \
  exec nginx nginx -t
```

The mount is live, so the running container already sees the checkout's
current files — and `nginx -t` only tests them, it does not load them. To
check *before* touching the production checkout at all, run the same test in a
throwaway container with the candidate config mounted over `conf.d`:

```sh
docker run --rm --network gba_front \
  -v /tmp/nginxcheck/conf.d:/etc/nginx/conf.d:ro \
  -v /root/src/bengaluru-votes-production/deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro \
  -v /root/src/bengaluru-votes-production/deploy/nginx/snippets:/etc/nginx/snippets:ro \
  -v bengaluru-votes-production_certs:/etc/letsencrypt:ro \
  nginx:stable nginx -t
```

`--network gba_front` is required, not optional: the production `location /`
uses a bare `proxy_pass http://app:4321`, which nginx resolves at config-load
time, so off-network the test fails with "host not found in upstream" and
tells you nothing about your actual change.

### What the script does, and why each step is there

1. **Preflight** — ssh reachable, the tree exists and is clean, the env file
   is present. A dirty tree stops the deploy: someone edited the box, and
   clobbering that automatically is never right.
2. **Tag `:previous`** — before the build, because the build overwrites
   `:latest`. There is no registry; this image on this box is the entire
   rollback story.
3. **Update the tree** to `origin/main` (staging) or the tag (production,
   detached).
4. **Build** with that environment's `SITE_ORIGIN`.
5. **Migrate** — forward-only and idempotent; a failure aborts before
   anything restarts, so the running version continues against the
   unchanged schema.
6. **`up -d`**.
7. **Production only: re-run `static-init`, unconditionally.** `up -d` does
   not re-run a one-shot that already succeeded, so skipping it serves the
   previous build's hashed `/_astro/*` filenames against new HTML and every
   page 404s its own CSS and JS.
8. **Verify, including a real POST.** A stack built with the wrong origin
   serves every page a healthy 200 and 403s every write, and nothing in
   `docker compose ps`, the healthcheck, or the logs reveals it:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/healthz
curl -sS -X POST https://<host>/api/ward-lookup \
  -H 'content-type: application/json' -H 'Origin: https://<host>' \
  -d '{"address":"MG Road, Bengaluru"}'   # 403 here means rebuild
```

### Cold boot ordering

Production comes up before staging. Production owns the `gba_front` network;
staging joins it as `external: true` and its `up` fails outright if that
network does not exist yet.

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

`$POSTGRES_USER`/`$POSTGRES_DB` must expand **inside the container**, where
the postgres image's own env actually holds them — not in your local shell,
where they're unset and would silently mangle the command into `psql -U ""
-d ""`. Wrap the psql call in `sh -c '...'` so expansion happens on the
container side:

```sh
docker compose -p bengaluru-votes-production -f deploy/compose.production.yml exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE otp_codes SET created_at = created_at - INTERVAL '\''25 hours'\'' WHERE destination = '\''<normalized-destination>'\'';"'
```

Use the **normalized** destination exactly as `src/lib/otp.ts#normalizeDestination`
would produce it — trimmed + lowercased for an email address (`trim().toLowerCase()`), trimmed only for a phone number — since that's what's actually stored in `otp_codes.destination`.

Verify the fix by attempting a fresh OTP request for that destination
immediately after — it should return `'sent'` again rather than
`'already_sent'`.

---

## k6 election-day load test (architecture §12; Task 65)

**Why this exists:** one k6 run is the acceptance test for the whole
single-VM sizing decision (architecture §14.1: 4 vCPU / 16 GB) — it proves
the nginx micro-cache holds election-day read volume with p95 < 500 ms,
that legitimate traffic through the CGNAT-sized rate-limit zones
(architecture §7) never sees a 429, and that the app origin renders each
unique URL at most once per cache TTL rather than once per request. The
script itself lives at
`tests/load/k6-election-day.js`; read its file-header comment for the full
design rationale (peak-RPS assumption, ward-id space, page mix, the
`X-Cache-Status` dependency).

**WHEN:** run this against **staging**, before election week — not on every
deploy, and never against production (staging is disposable; production
isn't). Re-run it any time the VPS size, nginx cache config, or rate
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
   late night), accepting the small residual risk. The script never touches
   OTP, votes, flags, or media endpoints, which keeps most of its traffic
   low-risk — but its `/api/ward-lookup` traffic is **not** low-risk any
   more. `tests/load/k6-election-day.js` was written when the endpoint was
   only ever called in pincode mode (`src/lib/pincode.ts` — a pure in-memory
   lookup, never touching the geocode budget). Pincode lookup was removed
   2026-08-14: a `{pincode: ...}` body is now a 400, not a lookup, so as
   committed the script's ward-lookup requests all fail rather than
   exercising anything. The script needs updating to send `{address: ...}`
   bodies before its `http_req_failed` threshold means what it claims to —
   and once it does, every one of those requests will spend real
   `GOOGLE_GEOCODING_API_KEY` quota and count against `GEOCODE_DAILY_BUDGET`,
   which is a real cost/spend consideration this option didn't carry before.

Either way, `X-Cache-Status` itself is now emitted everywhere the cache
invariant matters — see `deploy/nginx/snippets/security-headers.conf`'s own
comment for why that one-line addition is safe against the Task-60
add_header-inheritance gotcha.

**Install k6 on a separate load-generation machine — NOT the VPS.**
Generating load from the box under test would measure the generator
competing with the app for the same 4 vCPUs, not the real network path a
Bengaluru citizen's request takes. A laptop or a small cloud VM outside
Mumbai (so the run also reflects real internet latency, not localhost) is
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

**Run it** (no credentials — staging basic auth was removed 2026-08-13, step
5b above):

```sh
k6 run \
  -e BASE_URL=https://staging-bengaluruvotes.opencity.in \
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
| `rate_limited_429`: `count==0` | Legitimate ward-lookup/browsing traffic never trips the CGNAT-sized `api` zone (architecture §7). |
| `cache_hit_rate`: `rate>0.9` | The micro-cache — not the app origin — is absorbing the load (requires the staging prerequisite above to be addressed first). |

A ✗ on any threshold fails the acceptance test for the current VPS
size/config.

**If it fails:** the accepted remediation is a **plan upgrade** on the
Hostinger VPS (`docs/architecture.md` §14.1) followed by a re-run of this
same k6 command. This is explicitly NOT meant to trigger a
re-architecture — the whole point of the single-VM design's k6 gate is
"resize if short, don't redesign." If the `rate_limited_429` threshold
specifically fails (not the RPS/latency ones), that's a rate-limits.conf
zone-sizing question instead (architecture §7) — revisit the zone
rate/burst, not the box size.

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
  `docker compose -p bengaluru-votes-production -f deploy/compose.production.yml run --rm app sh -c 'restic snapshots --json | jq length'`
  trending upward daily, and that the healthchecks.io check for this job
  hasn't gone red (a missed ping = an ops alert by design, architecture
  §10). Rehearse a full restore (step 6 above) periodically, not just once
  at provisioning time. **None of this applies until step 6 above's backup
  target is chosen** — right now there is no restic repository to check.
- **Rollback:** retag the previous image and restart — **no migration step
  runs on this path** (architecture §14.4/§14.7: migrations are
  forward-only/backward-compatible, so rollback is never a schema
  operation):

  ```sh
  docker image tag bengaluru-votes:previous bengaluru-votes:latest
  docker compose -p bengaluru-votes-production -f deploy/compose.production.yml up -d
  docker compose -p bengaluru-votes-production -f deploy/compose.production.yml run --rm static-init
  ```

  `deploy/deploy.sh production --rollback` does exactly this (retag,
  restart, re-run `static-init`) and then re-verifies with a real POST —
  prefer it over the by-hand commands above. Either path depends on
  `:previous` still existing **on the box** — there is no registry to fall
  back on (architecture §14.3). Tag it before every deploy, and don't `docker image
  prune` without checking what you're about to delete.

---

## Provisioning record

**Provisioned 2026-08-13** on the Hostinger VPS (`76.13.244.198`, Mumbai,
4 vCPU / 16 GB / 193 GB).

| | |
|---|---|
| Production | `bengaluruvotes.opencity.in`, on tag `v2026.08.13` |
| Staging | `staging-bengaluruvotes.opencity.in`, tracking `main` |
| Certificates | Let's Encrypt, one per hostname, issued 2026-08-13, expiring 2026-11-11 |
| First admin | `tarball@gmail.com` (seeded via `seed:admin`) |
| Production data | 369 wards, 1 admin, 0 candidates |
| Staging data | 369 wards, 6 fictional candidates (`seed:dev`) |
| Interim stack | `/root/vps-deploy` and `bengaluru-votes:vps` removed after verification |

Verified at cutover: both hostnames 200 on `GET /`, `GET /kn/` and a hashed
`/_astro/` asset, and **non-403 on `POST /api/ward-lookup`**; staging 401s
anonymously and sets `X-Robots-Tag: noindex`; production sets no such header;
a staging container cannot reach production Postgres (proven with
`pg_isready` against both hosts, so the check is falsifiable in both
directions); `scripts/backup.sh` fails loudly on its missing
`RESTIC_REPOSITORY`.

### Changes since cutover

The block above is the record of what was true on 2026-08-13 at cutover; it
is deliberately not rewritten. What has changed since:

- **2026-08-13, later the same day — staging basic auth removed** (architecture
  §14.2). The "staging 401s anonymously" line above no longer holds: staging
  now 200s for anyone with the URL. `X-Robots-Tag: noindex` is unchanged and
  is now the only guard; `deploy/deploy.sh` asserts it on every staging
  deploy. The htpasswd generation step (5b) and the bind mount in
  `compose.production.yml` are both gone. Note what this makes public — the
  6 fictional `seed:dev` candidates on real ward names, and everything merged
  to `main` but not yet released.
- **2026-08-13 — production advanced to `v2026.08.13.2`** (Open City logo in
  the header lockup), from `v2026.08.13`.

### Outstanding, both recorded as unresolved dependencies

1. **No off-box backup** (dependency register §6.9). The nightly job fails by
   design at 02:00. Production now holds real citizen-facing data, so this is
   the first thing to close.
2. **No external uptime or SSL-expiry monitoring** (§6.14). Certificates
   expire **2026-11-11**; certbot renews automatically and nginx reloads
   daily, but nothing alerts if renewal fails silently. Let's Encrypt's own
   expiry notices go to `tarball@gmail.com` and are currently the only
   warning mechanism.

Also deferred: no `AAAA` records. The box has a global IPv6 address, but its
public reachability was never confirmed, so publishing one risks breaking
v6 clients and the next renewal. Add only after testing from a v6 network.
