# Static demo of the product on GitHub Pages

**Date:** 2026-07-22
**Status:** Approved design — ready for implementation plan

## Goal

Replace the standalone React prototype (`prototype/`) with a static build of the
**real Astro product**, hosted on GitHub Pages, so the team can show the actual
product to interested parties before the backend exists. The demo is the real
codebase frozen to static HTML — one source of truth, not a separate mock.

## Context

- The product is an Astro SSR app (`output: 'server'`, Node adapter): 27 pages
  query Postgres in their frontmatter, 14 API endpoints, OTP auth, media served
  from Postgres. Fully server-rendered; no page currently prerenders.
- GitHub Pages serves static files only — no server, no database, no API routes.
- The current `prototype/` is a separate React + Vite SPA with fictional mock
  data, deployed to `https://snarayanank2.github.io/bangalore-votes/` via
  `.github/workflows/deploy-prototype.yml`.
- The real pincode → ward table is not available (`data/pincode-wards.json` holds
  12 placeholder entries with fake pincodes). `data/gba.geojson` holds all 369
  real wards with names, Kannada names, zones, and population stats.

## How a static build carries data

Data is baked in at **build time**, not fetched at run time. The CI build job
starts a throwaway Postgres, seeds it, and runs `astro build`; Astro queries that
database while rendering each page and writes the answers directly into the HTML.
The database is then discarded — only HTML/CSS/JS is published. Visitors download
pre-rendered pages; no database is consulted. Whatever is seeded at build time is
what visitors see until the next build.

## Locked decisions

1. **Approach:** a gated "demo build mode" on the real Astro app, switched by a
   `DEMO_BUILD` env flag. Production SSR config is untouched when the flag is off.
2. **Scope:** read-only tour of the public pages. Contribution modals stay
   clickable but do not submit. Auth-gated pages (curator, admin, account) are
   excluded from the build entirely.
3. **Languages:** both English and Kannada. Fictional candidate text may fall
   back to English where Kannada is absent.
4. **Find-your-ward:** a searchable ward picker plus a clickable boundary map
   over all 369 real wards, navigating client-side. No API call.
5. **Data:** the existing dev seed. Real ward data for all 369 wards; fictional
   candidates/issues on the 2–3 seeded wards; other wards show the honest
   "candidate data pending" empty state.
6. **URL:** unchanged — `https://snarayanank2.github.io/bangalore-votes/`, so the
   build uses `base: '/bangalore-votes/'`.
7. **Publish flow:** a manual (`workflow_dispatch`) CI workflow. No committed
   build artifacts, no per-commit builds — runs only when triggered.
8. **Demo banner:** a persistent notice ("Demo — fictional data, no live
   backend") on every page.

## Architecture

### Build mode (`DEMO_BUILD`)

`astro.config.mjs` reads `process.env.DEMO_BUILD`. When set:

- `output: 'static'` instead of `'server'`, and the Node adapter is dropped.
- `base: '/bangalore-votes/'`.

When unset, the config is exactly today's SSR setup.

### Prerendering the pages

- Public content and list pages prerender under static output.
- Dynamic routes (`ward/[id]`, `ward/[id]/*`, `candidate/[slug]`,
  `partner/[slug]`, and their `/kn` variants) gain a `getStaticPaths` that
  enumerates ids/slugs from the build-time database. It runs only in the static
  build; the SSR build ignores it.
- Excluded from the static build: all `api/**` endpoints, `media/[id]/[hash]`,
  `healthz`, and the auth-gated pages (`curator/**`, `admin/**`, `account/**`,
  `login`). The mechanism (route-level `prerender` guards, config excludes, or
  moving server-only endpoints behind the flag) is settled during planning.

### Client-side neutralization

Islands read a Vite-inlined `import.meta.env.DEMO_BUILD`, baked into the demo
build's JavaScript, and render a demo state instead of calling the backend:

| Island / feature | Live behavior | Demo behavior |
|---|---|---|
| Home "find your ward" | POST `/api/ward-lookup` | Searchable picker + clickable map; client-side navigation |
| Register/Login modal | OTP request/verify | Shows "Demo — sign-in is disabled" |
| Flag modal | POST `/api/flags` | Submitting shows "Demo — not saved" |
| Vote modal | POST `/api/issue-votes` | Submitting shows "Demo — not saved" |
| `MeSlot` | Reads session | Always logged-out |
| Booth lookup | POST `/api/booth-lookup` | Shows a demo state; no live lookup |
| Partner EOI form | POST `/api/eoi` | Submitting shows "Demo — not saved" |

### CSP, nonces, analytics

The per-request CSP nonce comes from middleware, which does not run on a static
host. In the demo build: middleware CSP is not emitted (nothing enforces it on
Pages anyway), analytics/GA is disabled (no measurement id), and no inline script
depends on a runtime nonce. Confirm the build ships no broken inline scripts.

### Demo banner

A small persistent banner on every page states the demo is fictional with no live
backend. Rendered only when `DEMO_BUILD` is set.

## Deployment and cleanup

- Add `.github/workflows/deploy-demo.yml`, triggered by `workflow_dispatch` only.
  Steps: checkout → setup Node with npm cache → `npm ci` → service Postgres →
  `migrate` + `seed:wards` + `seed:dev` → `DEMO_BUILD=1 astro build` →
  `upload-pages-artifact` (path `dist/`) → `deploy-pages`.
- Delete `prototype/` (the React app, its tests, its config) and
  `.github/workflows/deploy-prototype.yml`.
- Pages Source stays "GitHub Actions." The URL is unchanged.

## Testing

- A build-time assertion that the demo output is static HTML with seed data baked
  in and no live `/api/` calls remaining in shipped scripts.
- The existing Playwright smoke suite, run against the built static site, adjusted
  for the picker/map home flow and the demo states of the contribution modals.

## Non-goals

- No real backend, database, or API at run time.
- No working authentication, contribution persistence, or curator/admin tooling.
- No real pincode/address geocoding (data unavailable).
- No custom domain (uses the existing project-pages path).
- No automatic rebuild on every commit — publishing is manual.

## Risks and open items

- **Astro SSR-vs-static route handling** is the fiddliest part: conditional
  `prerender`/`getStaticPaths` per route, and excluding server-only endpoints
  cleanly. Resolved during the implementation plan.
- **Build size/time:** 369 wards × sub-pages × two languages is a few thousand
  pages. Expected to be minutes; if it grows, the plan can trim which ward
  sub-pages prerender.
- **Kannada gaps** in fictional candidate data fall back to English — acceptable
  for a demo.
