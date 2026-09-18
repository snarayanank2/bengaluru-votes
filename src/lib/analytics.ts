/**
 * Google Analytics (gtag.js) snippet (architecture.md §8/§13; Task 58,
 * CSP allowances built out in Task 60 — src/lib/csp.ts).
 *
 * Rendered by src/layouts/Base.astro ONLY on public, indexable pages — the
 * gate is `!noindex && GA_MEASUREMENT_ID` (env). That gate cleanly excludes
 * every authenticated page without this module needing to know about roles:
 * `src/pages/account/*.astro` always render with `noindex={true}` (also
 * true of `/curator`, `/admin`, `/login`, `/partner/*` per
 * src/middleware.ts's `NOINDEX_PREFIXES`), and curator/admin pages never
 * render through Base at all — they use their own
 * `src/layouts/CuratorLayout.astro` / `AdminLayout.astro` — so GA can never
 * reach an authenticated screen even if a future page forgot to set
 * `noindex`.
 *
 * CACHE-SAFETY: the emitted markup is identical for every visitor of a
 * given page — only the per-request CSP nonce varies, the same discipline
 * as the `?src` writer (src/lib/attribution.ts). This module never reads
 * session/cookies/settings; GA's own cookies (`_ga`, etc.) are set
 * CLIENT-SIDE by gtag.js via `document.cookie`, never a server
 * `Set-Cookie` — so mounting this does not violate the "no Set-Cookie on a
 * public GET" invariant (architecture §5, proven end-to-end by Guard 1 of
 * tests/routes/cache-invariant.test.ts).
 *
 * TEST/DEV/CI DEFAULT: when `GA_MEASUREMENT_ID` is unset, Base.astro
 * renders NOTHING for GA (no loader, no inline config) — so the
 * cache-invariant byte-identical guard, and every other existing route
 * test, is unaffected by GA in the test environment.
 *
 * CSP (architecture §13): GA needs `www.googletagmanager.com` allowed as a
 * script source and `*.google-analytics.com` / `*.analytics.google.com`
 * allowed for `connect-src`/`img-src`. That header is built by
 * `src/lib/csp.ts#buildCsp` (Task 60) and emitted by the APP
 * (src/middleware.ts) on every response — nginx only passes it through
 * (deploy/nginx/snippets/security-headers.conf sets no CSP of its own; see
 * src/lib/csp.ts's docstring for why the app, not nginx, owns this header).
 * These GA hosts are in `buildCsp`'s BASE policy (present on every path),
 * the same precedent as the reCAPTCHA host allowance for anonymous writes.
 */

/** The gtag.js loader URL for a given GA4 measurement id. */
export function gaLoaderSrc(measurementId: string): string {
  return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
}

/**
 * The literal, dependency-free (no `import`/`require`/`export` inside the
 * emitted JS) inline gtag bootstrap — same convention as
 * `ATTRIBUTION_SCRIPT_SOURCE` (src/lib/attribution.ts). Built from
 * `measurementId` via a template literal (via `JSON.stringify`, never
 * hand-quoted) so the id embedded in the emitted JS can never drift from
 * what the loader `<script src>` above requested, and so a measurement id
 * can never break out of its string literal.
 */
export function gaConfigScriptSource(measurementId: string): string {
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(measurementId)});`;
}
