# syntax=docker/dockerfile:1
#
# GBA Elections Citizen Platform — single production image for BOTH the
# Astro app and the cron jobs container (Task 59; architecture.md §14).
# The `app` service runs this image as `node ./dist/server/entry.mjs`; the
# `jobs` service runs the SAME image as `supercronic /app/deploy/crontab`.
# Everything both entrypoints read from disk at runtime — the built Astro
# server, `data/`, `content/`, `drizzle/` migrations, `jobs/` + `src/`
# TypeScript (jobs run via `tsx`, not compiled), `deploy/crontab`, and
# `scripts/backup.sh` — must be present in the final stage. See the Task 59
# report (.superpowers/sdd/task-59-report.md) for how the runtime read paths
# were empirically verified against the actual `astro build` output.

########################################################################
# Stage 1: build — full (dev+prod) deps, `astro build` -> dist/
########################################################################
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Full source needed for the build: astro.config.mjs, src/, content/
# (content collections are synced at build time from content/pages/),
# public/, tsconfig.json, drizzle.config.ts, etc.
COPY . .

# Both OPTIONAL, and unset (the CI/production case) this RUN is exactly
# `npm run build` with no env of its own. They exist because astro.config.mjs
# resolves BOTH `site` and `security.allowedDomains` once, HERE, at build
# time — so an image destined for anything other than the two baked-in
# `*.opencity.in` hostnames has to be told at build time or it 403s every
# POST it serves. Used by the interim Hostinger VPS deploy; never passed by
# CI. The `-n` guards matter: BuildKit exposes a declared-but-unpassed ARG
# as an EMPTY string, and `process.env.SITE_ORIGIN ?? <default>` would take
# `''` over its default (`??` is nullish, not falsy) and build with an
# invalid empty `site`.
ARG SITE_ORIGIN
ARG EXTRA_ALLOWED_ORIGIN
RUN if [ -n "$SITE_ORIGIN" ]; then export SITE_ORIGIN; else unset SITE_ORIGIN; fi; \
    if [ -n "$EXTRA_ALLOWED_ORIGIN" ]; then export EXTRA_ALLOWED_ORIGIN; else unset EXTRA_ALLOWED_ORIGIN; fi; \
    npm run build

########################################################################
# Stage 2: deps-prod — production-only node_modules for the runtime image.
#
# tsx was moved from devDependencies to dependencies in package.json
# (package-lock.json regenerated to match) specifically so it survives
# `npm ci --omit=dev` here — the jobs service invokes `tsx jobs/*.ts`
# directly against this same pruned install, and without this move
# `npm ci --omit=dev` would strip tsx and every cron job would fail.
########################################################################
FROM node:22-slim AS deps-prod
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

########################################################################
# Stage 3: runtime
########################################################################
FROM node:22-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/snarayanank2/bengaluru-votes"

WORKDIR /app

# pg_dump           -> scripts/backup.sh. Debian bookworm's own repo only
#                       ships postgresql-client-15, but this platform's
#                       Postgres is v16 (docker-compose/CI both use
#                       postgres:16) — a v15 pg_dump REFUSES to dump a v16
#                       server ("aborting because of server version
#                       mismatch", confirmed empirically while verifying
#                       this image). So: add the PGDG apt repo and install
#                       postgresql-client-16 explicitly, not the bookworm
#                       default `postgresql-client` meta-package.
# restic             -> scripts/backup.sh's backup/verify step
# curl               -> scripts/backup.sh's healthchecks.io ping, and
#                       supercronic's own download below
# jq                 -> scripts/backup.sh's restic-snapshot-count check
# ca-certificates    -> TLS for pg_dump/restic/curl/the app's own outbound
#                       calls (geocode, SendGrid, Twilio, Anthropic, ...)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       postgresql-client-16 \
       restic \
       jq \
    && apt-get purge -y gnupg \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# supercronic (jobs container's cron scheduler; deploy/crontab is invoked as
# `supercronic /app/deploy/crontab`). Pinned version + published sha1sum,
# picked by target arch — see
# https://github.com/aptible/supercronic/releases/tag/v0.2.47's own
# "Installation Instructions" for the per-arch checksums used below.
ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.47
ARG SUPERCRONIC_SHA1SUM_AMD64=712d2ece75da6f6e530192a151488578153e4e96
ARG SUPERCRONIC_SHA1SUM_ARM64=93323899ddca3f1198f1796a4bf4418ed1e7982e
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) SUPERCRONIC_BIN="supercronic-linux-amd64"; SUPERCRONIC_SHA1SUM="${SUPERCRONIC_SHA1SUM_AMD64}" ;; \
      arm64) SUPERCRONIC_BIN="supercronic-linux-arm64"; SUPERCRONIC_SHA1SUM="${SUPERCRONIC_SHA1SUM_ARM64}" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    SUPERCRONIC_URL="https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/${SUPERCRONIC_BIN}"; \
    curl -fsSLO "$SUPERCRONIC_URL"; \
    echo "${SUPERCRONIC_SHA1SUM}  ${SUPERCRONIC_BIN}" | sha1sum -c -; \
    chmod +x "$SUPERCRONIC_BIN"; \
    mv "$SUPERCRONIC_BIN" /usr/local/bin/supercronic

# Production node_modules (tsx included — see Stage 2's comment).
COPY --from=deps-prod /app/node_modules ./node_modules

# Built Astro server + client assets.
COPY --from=build /app/dist ./dist

# Runtime file dependencies read straight off disk (NOT bundled into
# dist/server by esbuild) — empirically verified against this project's
# actual `astro build` output (see the Task 59 report):
#
#   - src/lib/geo.ts / src/lib/pincode.ts resolve
#     `path.join(__dirname, '..', '..', 'data', ...)` from wherever esbuild
#     places their compiled chunk. Both land under dist/server/chunks/, so
#     '..' '..' resolves to dist/ — i.e. dist/data/gba.geojson and
#     dist/data/pincode-wards.json, NOT /app/data. Copied to BOTH locations
#     below so the image is correct regardless of future chunk-layout
#     changes from an Astro/esbuild upgrade.
#   - src/i18n/content.ts resolves `new URL('../../content/pages/',
#     import.meta.url)` the same way: its compiled chunk also lands under
#     dist/server/chunks/, so this resolves to dist/content/pages/, not
#     /app/content. Copied to both locations for the same reason.
#   - src/db/migrate.ts reads `./drizzle` relative to CWD (WORKDIR /app),
#     so drizzle/ only needs to exist at /app/drizzle.
#   - The jobs service runs `tsx jobs/*.ts`, importing `src/lib/*`
#     TypeScript directly (no build step for jobs) — both jobs/ and src/
#     must ship as source.
COPY data ./data
COPY data ./dist/data
COPY content ./content
COPY content ./dist/content
COPY drizzle ./drizzle
COPY jobs ./jobs
COPY src ./src
COPY deploy ./deploy
COPY scripts ./scripts
COPY package.json ./package.json

# Non-root runtime user (review finding — Task 59 hardening). Both
# entrypoints run as this user: the `app` service's `node
# ./dist/server/entry.mjs` and the `jobs` service's `supercronic
# /app/deploy/crontab` (which in turn runs `tsx jobs/*.ts` per
# deploy/crontab). A system user/group (no login shell, no password) is
# enough — nothing here needs an interactive account.
#
# `chown -R appuser:appuser /app` AFTER every COPY above (and before the
# USER switch below) so appuser owns everything it needs to read (dist/,
# data/, content/, drizzle/, jobs/, src/, deploy/, scripts/) *and* the one
# thing it needs to WRITE at runtime: jobs/regen-sitemaps.ts ->
# src/lib/seo/sitemaps.ts's `regenerateSitemaps()` defaults its
# `outputDir` to `path.join(process.cwd(), 'public')` = `/app/public`,
# which doesn't exist yet at image-build time (`mkdirSync(..., {recursive:
# true})` creates it on first run) — so it's `/app` ownership, not a
# specific existing directory, that has to be right. scripts/backup.sh's
# pg_dump staging file needs no such treatment: it defaults to `mktemp -d`
# (world-writable /tmp) unless BACKUP_STAGING_DIR is set, so it's writable
# by any user without a chown.
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser \
    && chown -R appuser:appuser /app

ENV HOST=0.0.0.0 \
    PORT=4321 \
    NODE_ENV=production \
    PATH="/app/node_modules/.bin:${PATH}"

# deploy/crontab invokes jobs as bare `cd /app && tsx jobs/X.ts` (no `npm
# run`/`npx` wrapper to put node_modules/.bin on PATH for it) — confirmed by
# running a job that way and hitting "tsx: not found" until this PATH
# prepend was added. `npm run migrate`/`npm run seed:*` don't need this
# (npm already puts node_modules/.bin on PATH for scripts it runs), but the
# jobs container's raw supercronic-invoked commands do.

EXPOSE 4321

# Cron job log directory. Every deploy/crontab line redirects to
# `>> /var/log/gba-jobs/<job>.log 2>&1`; the jobs container runs as the
# non-root `appuser`, so supercronic's `sh -c` cannot open (let alone create)
# that redirect target unless the directory exists AND is appuser-writable.
# Without this, EVERY cron job fails with ENOENT before its command even runs
# (backups, run-campaign, retention, sitemaps, news-suggest,
# reconcile-suppressions, translate-retry). Created here, owned by appuser,
# BEFORE the USER switch below (mkdir/chown need root).
RUN mkdir -p /var/log/gba-jobs && chown appuser:appuser /var/log/gba-jobs

# Switch to the non-root user for both entrypoints. Everything above this
# line (apt installs, supercronic download, all COPYs, the chown) must run
# as root; nothing below it may need root again.
USER appuser

CMD ["node", "./dist/server/entry.mjs"]
