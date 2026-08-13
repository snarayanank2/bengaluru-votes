/**
 * The single session/CSRF/authorization/cache-safety enforcement point
 * (architecture.md §7, §13; PRD §7). Every request passes through here
 * before any page/API route runs. SECURITY-CRITICAL: this is where roles
 * and curator route-classes are gated, where unsafe methods are checked for
 * cross-site origin, and where the cache-safety invariant (public GETs never
 * set a cookie — architecture §5) is upheld by simple omission: this module
 * never calls `cookies.set`/`cookies.delete` at all, on any route.
 *
 * LOCALS produced for every request: `{ lang, session, user, csrfToken,
 * cspNonce }` (typed in src/env.d.ts). `session` is `{userId, role} | null`
 * from src/lib/session.ts#readSession — never a DB write from a cookie
 * itself (readSession's sliding-expiry write, if any, is a `sessions` row
 * update, not a `Set-Cookie`).
 *
 * RESPONSE HEADERS set here on every response, via `respond()`: the
 * `Content-Security-Policy` header (Task 60, src/lib/csp.ts#buildCsp, built
 * from `locals.cspNonce` + `pathname` — see that module's docstring for why
 * the app, not nginx, owns this header) and, on `NOINDEX_PREFIXES` routes,
 * `X-Robots-Tag: noindex`.
 *
 * ROUTE CLASSES:
 *  - PUBLIC: everything NOT under /account, /curator, /admin, /api, /login,
 *    /media. Never blocked here; no guard, no CSRF check. (`/partner/*` is
 *    public in this sense — anonymous, no session read — but still gets the
 *    SEO noindex header below; those are independent concerns.)
 *  - /account/*, /curator/*, /admin/*: authenticated form routes. GET (and
 *    every other method) requires a session; wrong role -> 403; no session
 *    -> redirect to `/login?next=<validated relative path>`. Unsafe methods
 *    additionally require a valid synchronizer CSRF token (src/lib/csrf.ts).
 *    Per-ward curator scope (`canEditWard`, src/lib/authz.ts) is NOT checked
 *    here — the middleware only knows the route class, not which ward a
 *    specific edit targets; that's checked where the ward id is known
 *    (Task 34/36/39 call `canEditWard` directly).
 *  - /api/webhooks/*: exempt from the Origin/Sec-Fetch-Site check (no
 *    session, no CSRF token — vendor POSTs are signature-verified instead,
 *    Task 53) and from every route guard above.
 *  - /api/otp/*: NOT exempt from the Origin/Sec-Fetch-Site check (still
 *    enforced), but exempt from the synchronizer-token requirement (no
 *    session exists yet to bind one to).
 *  - every other /api/*: Origin/Sec-Fetch-Site check applies; no
 *    synchronizer token requirement (JSON APIs rely on Origin check +
 *    SameSite cookies + their own session check, not a form-embedded
 *    token — Task 31/33).
 *
 * UNSAFE METHODS (POST/PUT/DELETE/PATCH), non-webhook: rejected 403 unless
 * `Sec-Fetch-Site` is `same-origin`/`none`, OR (when that header is absent)
 * `Origin` equals this deployment's own origin (`SITE_ORIGIN`/`Astro.site`).
 * If NEITHER header is present the request is rejected — modern browsers
 * always send at least one of these on a cross-document or fetch POST, so
 * an absent pair is itself a signal something is off (a hand-crafted
 * request, an ancient/misbehaving client), and this design deliberately
 * favours failing closed (architecture §13: "forged curator publishes are
 * the worst outcome this design can produce").
 */
import { defineMiddleware } from 'astro:middleware';
import { randomBytes } from 'node:crypto';
import { readSession, SESSION_COOKIE, type Role } from './lib/session';
import { issueCsrfToken, checkCsrfToken, CSRF_FIELD_NAME } from './lib/csrf';
import { isSameOriginRelative } from './lib/authz';
import { buildCsp } from './lib/csp';
import { captureException } from './lib/logger';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** True for `pathname === prefix` or `pathname` under `prefix/…`. Never a bare substring match (`/partner` must not match `/partner-with-us`). */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isUnderAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => isUnder(pathname, p));
}

/**
 * Strips a leading `/kn` locale prefix so prefix-based route-class checks
 * (route guards, CSRF form-route check, noindex) apply identically to a
 * `/kn/…` twin as to its English original — e.g. `/kn/account/submissions`
 * must be guarded exactly like `/account/submissions`. Only used for prefix
 * MATCHING; the raw `pathname` is still used for `locals.lang` detection,
 * the actual request/response, and redirect targets (Task 48 review,
 * Task 26 bug: the /kn/ twin of an authenticated route was reachable
 * without a session because the guard matched the raw, un-stripped path).
 */
function stripLocalePrefix(pathname: string): string {
  return pathname.replace(/^\/kn(?=\/|$)/, '') || '/';
}

const AUTH_FORM_PREFIXES = ['/account', '/curator', '/admin'];
const NOINDEX_PREFIXES = ['/partner', '/account', '/curator', '/admin', '/login'];

function forbidden(): Response {
  return new Response('Forbidden', { status: 403 });
}

function redirectToLogin(currentPathAndQuery: string): Response {
  const next = isSameOriginRelative(currentPathAndQuery);
  return new Response(null, {
    status: 302,
    headers: { Location: `/login?next=${encodeURIComponent(next)}` },
  });
}

/**
 * Same-origin check for an unsafe-method request. `siteOrigin` is this
 * deployment's own origin string (e.g. `https://bengaluruvotes.opencity.in`).
 */
function passesOriginCheck(request: Request, siteOrigin: string): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite) return secFetchSite === 'same-origin' || secFetchSite === 'none';

  const origin = request.headers.get('origin');
  if (origin) return origin === siteOrigin;

  // Neither header present: fail closed rather than guess.
  return false;
}

/** Extracts the synchronizer token from a form-encoded (or JSON) mutating request WITHOUT consuming the original body — downstream route handlers still need to read it. */
async function extractCsrfToken(request: Request): Promise<string | null> {
  const contentType = request.headers.get('content-type') ?? '';
  try {
    const clone = request.clone();
    if (contentType.includes('application/json')) {
      const body = (await clone.json()) as Record<string, unknown> | null;
      const value = body?.[CSRF_FIELD_NAME];
      return typeof value === 'string' ? value : null;
    }
    // application/x-www-form-urlencoded or multipart/form-data.
    const form = await clone.formData();
    const value = form.get(CSRF_FIELD_NAME);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** The raw `sessions.id` portion of the `bv_session` cookie value (`id.hmac`) — what `issueCsrfToken`/`checkCsrfToken` bind the synchronizer token to. Safe to trust here without re-checking the HMAC ourselves: this is only ever read after `readSession` already returned non-null for this exact cookie value, i.e. after the HMAC was verified in constant time. */
function sessionIdFromCookieValue(cookieValue: string): string {
  return cookieValue.split('.')[0] ?? '';
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, cookies, locals, site } = context;
  const pathname = url.pathname;
  const method = request.method.toUpperCase();
  // Locale-stripped pathname for prefix MATCHING only (route guards, CSRF
  // form-route check, noindex) — never for lang detection, redirect
  // targets, or anything else that needs the real path.
  const guardPath = stripLocalePrefix(pathname);

  // --- locals: lang, session, csrfToken, cspNonce -------------------------
  locals.lang = pathname === '/kn' || pathname.startsWith('/kn/') ? 'kn' : 'en';

  const cookieValue = cookies.get(SESSION_COOKIE)?.value;
  const session = cookieValue ? await readSession(cookieValue) : null;
  locals.session = session;
  locals.user = session;

  locals.csrfToken = session && cookieValue ? issueCsrfToken(sessionIdFromCookieValue(cookieValue)) : '';
  locals.cspNonce = randomBytes(16).toString('base64');

  // Every response (Task 60, architecture §13): the app-emitted CSP, built
  // from this same request's nonce + pathname (src/lib/csp.ts#buildCsp) —
  // see that module's docstring for why the APP sets this header rather
  // than nginx. Pure function of (nonce, pathname): never varies by
  // session, so it doesn't disturb the cache-safety invariant (a cached
  // response's stored header always matches its stored HTML's nonce).
  const respond = (response: Response): Response => {
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', buildCsp(locals.cspNonce, pathname));
    if (isUnderAny(guardPath, NOINDEX_PREFIXES)) {
      headers.set('X-Robots-Tag', 'noindex');
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };

  const isWebhook = isUnder(pathname, '/api/webhooks');

  // --- unsafe-method Origin/Sec-Fetch-Site check --------------------------
  if (UNSAFE_METHODS.has(method) && !isWebhook) {
    const siteOrigin = (site ?? new URL(process.env.SITE_ORIGIN ?? 'https://bengaluruvotes.opencity.in')).origin;
    if (!passesOriginCheck(request, siteOrigin)) {
      return respond(forbidden());
    }
  }

  // --- route guards: /account/*, /curator/*, /admin/* (and their /kn/
  // twins, via guardPath) ---------------------------------------------------
  const role: Role | undefined = session?.role;

  if (isUnder(guardPath, '/account')) {
    if (!session) return respond(redirectToLogin(pathname + url.search));
  }
  if (isUnder(guardPath, '/curator')) {
    if (!session) return respond(redirectToLogin(pathname + url.search));
    if (role !== 'curator' && role !== 'admin') return respond(forbidden());
  }
  if (isUnder(guardPath, '/admin')) {
    if (!session) return respond(redirectToLogin(pathname + url.search));
    if (role !== 'admin') return respond(forbidden());
  }

  // --- synchronizer CSRF token: unsafe methods on authenticated form routes
  if (UNSAFE_METHODS.has(method) && isUnderAny(guardPath, AUTH_FORM_PREFIXES)) {
    // Route guards above already ensured `session`/`cookieValue` are set for
    // any request reaching this point on these prefixes.
    const sessionId = sessionIdFromCookieValue(cookieValue!);
    const token = await extractCsrfToken(request);
    if (!checkCsrfToken(sessionId, token)) {
      return respond(forbidden());
    }
  }

  // Task 63: an unhandled error from downstream (a page/route handler
  // throwing rather than returning a Response) is reported to Sentry
  // (scrubbed, env-gated — src/lib/logger.ts) before it's rethrown, so
  // behavior is otherwise unchanged: no error is swallowed here, and this
  // is the one Astro middleware boundary every request passes through.
  let response: Response;
  try {
    response = await next();
  } catch (err) {
    captureException(err);
    throw err;
  }
  return respond(response);
});
