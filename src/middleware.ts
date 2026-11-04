/**
 * The single session/CSRF/authorization/cache-safety enforcement point
 * (architecture.md §7, §13). Every request passes through here
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
 *  - PUBLIC: everything NOT under /curator, /admin, /transcribe, /api,
 *    /login, /media. Never blocked here; no guard, no CSRF check.
 *  - /curator/*, /admin/*, /transcribe/*: authenticated staff form routes. GET (and
 *    every other method) requires a session; wrong role -> 403; no session
 *    -> redirect to `/login?next=<validated relative path>`. Unsafe methods
 *    additionally require a valid synchronizer CSRF token (src/lib/csrf.ts).
 *    There is no per-ward scope: curators and admins are both city-wide
 *    (decided 2026-08-15), so the role check here is the whole answer.
 *  - /api/*: Origin/Sec-Fetch-Site check applies; no
 *    synchronizer token requirement (JSON APIs rely on Origin check +
 *    SameSite cookies + their own session check, not a form-embedded
 *    token — Task 31/33).
 *
 * UNSAFE METHODS (POST/PUT/DELETE/PATCH): rejected 403 unless
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
import { assertMasterPasswordConfig } from './lib/master-login';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** True for `pathname === prefix` or `pathname` under `prefix/…`. Never a bare substring match (`/admin` must not match `/administer`). */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isUnderAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => isUnder(pathname, p));
}

/**
 * Strips a leading `/kn` locale prefix so prefix-based route-class checks
 * (route guards, CSRF form-route check, noindex) apply identically to a
 * `/kn/…` twin as to its English original — e.g. `/kn/curator` must be
 * guarded exactly like `/curator`. Only used for prefix
 * MATCHING; the raw `pathname` is still used for `locals.lang` detection,
 * the actual request/response, and redirect targets (Task 48 review,
 * Task 26 bug: the /kn/ twin of an authenticated route was reachable
 * without a session because the guard matched the raw, un-stripped path).
 */
function stripLocalePrefix(pathname: string): string {
  return pathname.replace(/^\/kn(?=\/|$)/, '') || '/';
}

const AUTH_FORM_PREFIXES = ['/curator', '/admin', '/transcribe'];
const NOINDEX_PREFIXES = ['/curator', '/admin', '/transcribe', '/login'];

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

  // --- one URL per page: canonical trailing-slash form --------------------
  // `/about/` -> `/about`, `/kn` -> `/kn/` (the Kannada home canonical).
  // GET/HEAD only, so a POST to either form is never redirected. Sets no
  // cookie, so it is cache-safe like every other public response.
  if (method === 'GET' || method === 'HEAD') {
    const canonicalPath = pathname === '/kn' ? '/kn/' : pathname.length > 1 && pathname !== '/kn/' && pathname.endsWith('/') ? pathname.replace(/\/+$/, '') : null;
    if (canonicalPath && canonicalPath !== pathname) {
      return respond(new Response(null, { status: 301, headers: { Location: canonicalPath + url.search } }));
    }
  }

  // Evaluated on EVERY request so a too-short MASTER_PASSWORD
  // (src/lib/master-login.ts) throws at once, health check included,
  // instead of running with a guessable password.
  assertMasterPasswordConfig();

  // --- unsafe-method Origin/Sec-Fetch-Site check --------------------------
  if (UNSAFE_METHODS.has(method)) {
    const siteOrigin = (site ?? new URL(process.env.SITE_ORIGIN ?? 'https://bengaluruvotes.opencity.in')).origin;
    if (!passesOriginCheck(request, siteOrigin)) {
      return respond(forbidden());
    }
  }

  // --- route guards: /curator/*, /admin/*, /transcribe/* (and their /kn/
  // twins, via guardPath) ---------------------------------------------------
  const role: Role | undefined = session?.role;

  if (isUnder(guardPath, '/curator')) {
    if (!session) return respond(redirectToLogin(pathname + url.search));
    if (role !== 'curator' && role !== 'admin') return respond(forbidden());
  }
  if (isUnder(guardPath, '/admin')) {
    if (!session) return respond(redirectToLogin(pathname + url.search));
    if (role !== 'admin') return respond(forbidden());
  }
  // Transcribers and admins only: curators correct flagged values and do not
  // read the queue. The role admits the caller to
  // the area; which AFFIDAVIT they may read or save is decided per request by
  // src/lib/transcribe.ts — an open assignment that is theirs — not here.
  if (isUnder(guardPath, '/transcribe')) {
    if (!session) return respond(redirectToLogin(pathname + url.search));
    if (role !== 'transcriber' && role !== 'admin') return respond(forbidden());
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

  return respond(await next());
});
