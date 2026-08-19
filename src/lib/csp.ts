/**
 * Content-Security-Policy header value (Task 60, architecture.md §13) —
 * built and emitted by the APP (src/middleware.ts wires `buildCsp` below
 * into every response), NOT by nginx.
 *
 * WHY THE APP, NOT NGINX (architecture §13 literally says "nginx sets the
 * CSP"): that's incompatible with per-request script nonces under nginx's
 * anonymous-page micro-cache (deploy/nginx/snippets/cache.conf). nginx has
 * no way to generate a nonce that matches the nonce already baked into the
 * cached HTML by src/layouts/Base.astro (`Astro.locals.cspNonce`, minted
 * once per request in src/middleware.ts). So the app builds this header
 * from that SAME nonce and bakes it into the response middleware already
 * produces; nginx's `deploy/nginx/snippets/security-headers.conf` sets only
 * the static headers (HSTS, X-Content-Type-Options, Referrer-Policy) and
 * deliberately does NOT set or strip Content-Security-Policy — it passes
 * the app's header through untouched.
 *
 * CACHE-SAFETY: `buildCsp` is a PURE function of `(nonce, pathname)` —
 * never of session/cookies/anything request-specific beyond those two
 * values — so for any one cached response (nginx microcaches headers+body
 * as one unit, architecture §5) the stored CSP header and the stored HTML's
 * baked-in nonce always agree with each other, exactly like every other
 * per-request-but-not-per-session value this layout already bakes in (see
 * src/layouts/Base.astro's cache-safety docstring, and the `?src` writer in
 * src/lib/attribution.ts). Do not add any session/cookie-derived input to
 * this function.
 */

const PARTNER_PATH = '/partner-with-us';

/**
 * Same locale-prefix-stripping rule as src/middleware.ts#stripLocalePrefix
 * (`/kn/partner-with-us` must match exactly like `/partner-with-us`) — kept
 * as an independent copy rather than an import so this module stays a
 * small, dependency-free pure function directly unit-testable
 * (tests/unit/csp.test.ts) without pulling in astro:middleware.
 */
function stripLocalePrefix(pathname: string): string {
  return pathname.replace(/^\/kn(?=\/|$)/, '') || '/';
}

/**
 * Strips a single optional trailing slash (never touches the root `/`
 * itself). Astro's default `trailingSlash: 'ignore'` routes
 * `/partner-with-us/` to the exact same page as `/partner-with-us` — without
 * this normalization `isPartnerWithUsPath` would miss that variant on exact
 * equality and silently fail to relax the CSP for reCAPTCHA there. Applied
 * BEFORE the exact-match comparison (not a prefix match), so
 * `/partner-with-us/sub` still correctly does NOT match (it strips to
 * `/partner-with-us/sub`, not `/partner-with-us`).
 */
function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function isPartnerWithUsPath(pathname: string): boolean {
  return stripTrailingSlash(stripLocalePrefix(pathname)) === PARTNER_PATH;
}

function isWardDetailPath(pathname: string): boolean {
  return /^\/ward\/\d+$/.test(stripTrailingSlash(stripLocalePrefix(pathname)));
}

/**
 * Builds the full CSP header value for one response.
 *
 * `script-src` is STRICT everywhere: `'self'` + this request's nonce + the
 * GA loader host (`www.googletagmanager.com`) + the Google Maps Platform
 * hosts (`maps.googleapis.com`, `maps.gstatic.com`, spec §8 — see the
 * `MAPS_HOSTS` comment inside the function body) — NO `'unsafe-inline'` on
 * scripts (architecture §13). The two inline scripts this codebase ever
 * renders (the `?src` attribution writer and the GA config snippet, both in
 * src/layouts/Base.astro) carry `nonce={cspNonce}`, the same `nonce` value
 * passed in here.
 *
 * `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`: the
 * `'unsafe-inline'` is a deliberate, pragmatic tradeoff — NOT the thing
 * architecture §13's "no unsafe-inline" rule targets (that rule is about
 * scripts). Astro emits scoped component styles as inline `<style>` tags
 * with compiler-generated content we don't control, and some components
 * (e.g. Button.astro) use inline `style="…"` attributes; nonce/hash-locking
 * style-src would require threading a nonce through every
 * Astro-scoped-style tag, which Astro's compiler doesn't support. The
 * fonts.googleapis.com host is separate and narrower — see the Maps font
 * hosts comment in `buildCsp` for why the Maps JS API needs it.
 *
 * `worker-src 'self' blob:`: the Google Maps JavaScript API
 * (src/islands/WardMap.ts, the ward boundary map) constructs workers from
 * `blob:` URLs internally — without this the map silently fails and the
 * container keeps its server-rendered fallback text. This directive
 * predates the Google migration (MapLibre needed it for the same reason)
 * and is unchanged by it.
 *
 * GA hosts (`www.googletagmanager.com` / `*.google-analytics.com` /
 * `*.analytics.google.com`) are always present in the base policy —
 * harmless on pages where GA doesn't actually render (src/lib/analytics.ts
 * gates GA to public+indexable pages only; this module doesn't need to
 * know that).
 *
 * PARTNER EXTENSION: on `/partner-with-us` and `/kn/partner-with-us` ONLY
 * (matched the same locale-aware way src/middleware.ts matches every other
 * path prefix — strip a leading `/kn`, compare the rest, THEN strip a single
 * optional trailing slash before the exact-equality check, since Astro's
 * default `trailingSlash: 'ignore'` routes `/partner-with-us/` to the same
 * page and the CSP must relax there too — see `stripTrailingSlash` below),
 * reCAPTCHA v3 (src/features/pages/PartnerWithUs.astro) needs
 * `www.google.com` and `www.gstatic.com` added to `script-src`, and the base
 * `frame-src 'none'` relaxed to `https://www.google.com` (reCAPTCHA injects
 * its challenge iframe from that host). No other path gets these hosts
 * relaxed — in particular a genuine subpath like `/partner-with-us/sub`
 * still does not match after trailing-slash stripping.
 */
export function buildCsp(nonce: string, pathname: string): string {
  // Google Maps Platform (spec §8): the ward-boundary map
  // (src/islands/WardMap.ts), the only consumer today, on /ward/* and
  // /kn/ward/*. (Places Autocomplete for ward lookup was scoped for
  // src/islands/WardLookup.ts but did not ship — see the deferral note in
  // that area of the codebase — so there is currently exactly one consumer
  // on one route family.) These hosts live in the BASE policy rather than a
  // path-scoped extension like the reCAPTCHA one below; scoping them to
  // /ward/* (and /kn/ward/*) the way PARTNER EXTENSION scopes reCAPTCHA is
  // a viable follow-up now that a second consumer on a different route
  // didn't materialize — it just hasn't been done.
  //
  // `script-src`: @googlemaps/js-api-loader injects a <script src=…> at
  // runtime. A script element whose src matches an allowlisted host does
  // not additionally need the nonce, so the nonce-only policy still holds
  // for inline script.
  const MAPS_HOSTS = ['https://maps.googleapis.com', 'https://maps.gstatic.com'] as const;

  // The Maps JS API also pulls UI font/icon stylesheets from
  // fonts.googleapis.com and the font files themselves from
  // fonts.gstatic.com. Verified in a real browser on 2026-08-14: without
  // these, every ward page load logged three `violates the following Content
  // Security Policy directive: "style-src …"` errors and the map's controls
  // rendered without their icon font.
  //
  // Worth knowing WHY this class of failure is worse than it looks: it is
  // the one Maps failure src/islands/WardMap.ts's failure-closed contract
  // cannot catch. Loader rejection and gm_authFailure both happen before or
  // instead of a working map, so the fallback survives — but a blocked
  // SUBRESOURCE fails after `container.textContent = ''`, leaving a broken
  // map where the server-rendered fallback used to be.
  //
  // These are three DIFFERENT hosts that differ only by subdomain:
  // fonts.gstatic.com (font files), maps.gstatic.com (map assets), and
  // www.gstatic.com (reCAPTCHA, added only on /partner-with-us below). Do
  // not collapse them.
  const MAPS_FONT_STYLE_HOST = 'https://fonts.googleapis.com';
  const MAPS_FONT_FILE_HOST = 'https://fonts.gstatic.com';

  // Places API (NEW) — used by the ward-lookup autocomplete
  // (src/islands/WardLookup.ts). It does NOT go through maps.googleapis.com:
  // predictions are RPCs posted to places.googleapis.com. Verified in a real
  // browser on 2026-08-14, where every keystroke logged `violates …
  // connect-src` and the field silently never suggested anything.
  //
  // connect-src ONLY. It is an RPC endpoint, not a script or image source,
  // so it is deliberately not folded into MAPS_HOSTS above.
  const PLACES_RPC_HOST = 'https://places.googleapis.com';

  const scriptSrcHosts = ['https://www.googletagmanager.com', ...MAPS_HOSTS];
  let frameSrc = "'none'";

  if (isPartnerWithUsPath(pathname) || isWardDetailPath(pathname)) {
    scriptSrcHosts.push('https://www.google.com', 'https://www.gstatic.com');
    frameSrc = 'https://www.google.com';
  }

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `script-src 'self' 'nonce-${nonce}' ${scriptSrcHosts.join(' ')}`,
    `style-src 'self' 'unsafe-inline' ${MAPS_FONT_STYLE_HOST}`,
    `img-src 'self' data: https://www.googletagmanager.com https://*.google-analytics.com ${MAPS_HOSTS.join(' ')}`,
    `font-src 'self' ${MAPS_FONT_FILE_HOST}`,
    `connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com ${MAPS_HOSTS.join(' ')} ${PLACES_RPC_HOST}`,
    `worker-src 'self' blob:`,
    `frame-src ${frameSrc}`,
  ];

  return directives.join('; ');
}
