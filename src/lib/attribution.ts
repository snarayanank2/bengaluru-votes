/**
 * `?src={partner-slug}` attribution (architecture.md §5, §13; dormant, §15).
 *
 * The nginx micro-cache key ignores the query string entirely (architecture
 * §5), so the server can never branch on `?src` without breaking cache
 * safety — there is exactly one cached HTML variant per URL/language, and it
 * must be byte-identical whether or not a `?src` param is present. The whole
 * mechanism therefore lives client-side: `src/layouts/Base.astro` renders
 * `ATTRIBUTION_SCRIPT_SOURCE` as ONE of the two CSP-allowed nonce'd inline
 * scripts (the other is GA, Task 58/src/lib/analytics.ts) on every page. The script reads
 * `location.search` at runtime (the server HTML is identical with or
 * without `?src` — only the browser sees the query string) and, if a valid
 * slug is present, writes it to the `SRC_COOKIE_NAME` cookie. The
 * registration endpoint (`src/pages/api/otp/verify.ts`, via
 * `src/lib/auth-flow.ts#resolveOrRegister`) reads that same cookie name and
 * persists it onto the new user row as `srcAttribution` — attribution is
 * measurement-only: it grants no permission and changes nothing
 * the citizen sees.
 *
 * LAST-VALID-`src`-WINS: the script overwrites any existing `bv_src` cookie
 * whenever the current URL carries a valid slug, and leaves the cookie
 * untouched otherwise (no `?src`, or an invalid one). A citizen who arrives
 * via a second partner's link during the 30-day window is reattributed to
 * that newer partner rather than the first. This is the simpler of the two
 * defensible policies (first-touch is the other) and is an accepted,
 * intentional choice — not a bug.
 *
 * The slug pattern/length here MUST match `src/lib/partners.ts`'s
 * `SLUG_PATTERN`/`isValidPartnerSlug` — that module owns the authoritative
 * shape of a partner slug (used for the `/partner/{slug}` URL and CRUD
 * validation); this module keeps its own copy because the value also has to
 * be inlined, as a regex LITERAL, into a dependency-free browser script that
 * cannot `import` anything. Keeping both patterns textually identical (and
 * covered by tests on both sides) is the guard against drift.
 */

/** Same cookie name the registration endpoint reads (src/pages/api/otp/verify.ts:70, via src/lib/auth-flow.ts). */
export const SRC_COOKIE_NAME = 'bv_src';

/** 30 days, in seconds — the window in which "the value survives the visit". */
export const SRC_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Reasonable ceiling so a garbage/oversized `?src` value is never stored, even if it happened to match the shape below. */
export const SRC_SLUG_MAX_LENGTH = 64;

/** Must match `src/lib/partners.ts`'s `SLUG_PATTERN` (lowercase alphanumeric, hyphen-separated, no leading/trailing/doubled hyphens). */
export const SRC_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Pure, unit-testable validity check — the same rule the inline script below applies at runtime, kept here once so it's independently testable. */
export function isValidSrcSlug(value: string): boolean {
  return value.length > 0 && value.length <= SRC_SLUG_MAX_LENGTH && SRC_SLUG_PATTERN.test(value);
}

/**
 * The literal, dependency-free (no `import`/`require`) source of the `?src`
 * writer — one of exactly two CSP-allowed inline scripts (architecture
 * §13). Built from the constants above via a template literal (rather than
 * hand-duplicated) so the cookie name, slug pattern, max length, and max age
 * baked into the emitted JS can never drift from the exported constants a
 * test can check independently.
 *
 * Rendered by src/layouts/Base.astro as:
 *   <script nonce={Astro.locals.cspNonce} is:inline set:html={ATTRIBUTION_SCRIPT_SOURCE} />
 *
 * IIFE body: read `src` from `URLSearchParams(location.search)`; if present,
 * non-empty, within the length ceiling, and matching the slug pattern, set
 * `document.cookie` to `bv_src=<slug>; Max-Age=2592000; Path=/; SameSite=Lax`
 * (not `HttpOnly` — it is set by JS, so it cannot be; this is attribution
 * metadata, not a session token). Otherwise do nothing — an absent or
 * invalid `?src` never touches an existing cookie.
 */
export const ATTRIBUTION_SCRIPT_SOURCE = `(function(){var s=new URLSearchParams(location.search).get(${JSON.stringify(
  'src'
)});if(s&&s.length<=${SRC_SLUG_MAX_LENGTH}&&${SRC_SLUG_PATTERN}.test(s)){document.cookie=${JSON.stringify(
  `${SRC_COOKIE_NAME}=`
)}+encodeURIComponent(s)+"; Max-Age=${SRC_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax";}})();`;
