import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { onRequest } from '../../src/middleware';
import { createSession, SESSION_COOKIE } from '../../src/lib/session';
import { issueCsrfToken } from '../../src/lib/csrf';
import { canEditWard, isSameOriginRelative } from '../../src/lib/authz';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const SITE_URL = new URL(SITE_ORIGIN);

// High, task-specific ward ids (this file owns 99001/99002 — see task-25/26
// briefs for the numbering convention shared across route test files).
const WARD = {
  id: 99001,
  nameEn: 'Middleware Test Ward',
  nameKn: 'ಮಧ್ಯಸ್ಥಿಕೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'middleware-test-ward',
};
const UNSCOPED_WARD_ID = 99002;

const EMAILS = {
  citizen: 'middleware-citizen@example.com',
  curator: 'middleware-curator@example.com',
  admin: 'middleware-admin@example.com',
};

let citizenId: number;
let curatorId: number;
let adminId: number;

async function upsertUser(email: string, role: 'citizen' | 'curator' | 'admin'): Promise<number> {
  const [row] = await db
    .insert(schema.users)
    .values({ email, role, status: 'active' })
    .onConflictDoUpdate({ target: schema.users.email, set: { role, status: 'active' } })
    .returning({ id: schema.users.id });
  return row!.id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });

  await db
    .insert(schema.wards)
    .values([WARD, { ...WARD, id: UNSCOPED_WARD_ID, boundaryRef: 'middleware-test-ward-2' }])
    .onConflictDoNothing();

  citizenId = await upsertUser(EMAILS.citizen, 'citizen');
  curatorId = await upsertUser(EMAILS.curator, 'curator');
  adminId = await upsertUser(EMAILS.admin, 'admin');

  await db
    .insert(schema.curatorScopes)
    .values({ userId: curatorId, wardId: WARD.id })
    .onConflictDoNothing();
});

afterAll(async () => {
  const userIds = [citizenId, curatorId, adminId];
  await db.delete(schema.curatorScopes).where(inArray(schema.curatorScopes.userId, userIds));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
  await db.delete(schema.users).where(inArray(schema.users.email, Object.values(EMAILS)));
  await client.end();
});

type CtxOptions = {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  cookieValue?: string;
  body?: string;
  contentType?: string;
};

function makeContext({ method = 'GET', path, headers = {}, cookieValue, body, contentType }: CtxOptions) {
  const url = new URL(path, SITE_URL);
  const reqHeaders = new Headers(headers);
  if (contentType) reqHeaders.set('content-type', contentType);

  const request = new Request(url, {
    method,
    headers: reqHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });

  const locals: Record<string, unknown> = {};

  return {
    request,
    url,
    site: SITE_URL,
    cookies: {
      get: (name: string) => (name === SESSION_COOKIE && cookieValue ? { value: cookieValue } : undefined),
    },
    locals,
  } as any;
}

function nextStub(status = 200) {
  return vi.fn(async () => new Response('ok', { status }));
}

async function sessionFor(userId: number) {
  return createSession(userId);
}

/**
 * `onRequest` is typed via Astro's `MiddlewareHandler` union
 * (`Promise<Response> | Response | Promise<void> | void`) because
 * `defineMiddleware`'s declared return type doesn't narrow to the specific
 * handler passed in — but src/middleware.ts always returns a `Response`
 * (never falls through to `void`), so tests call it through this thin,
 * narrowly-typed wrapper instead of casting at every call site.
 */
async function run(ctx: unknown, next: ReturnType<typeof nextStub>): Promise<Response> {
  return (await onRequest(ctx as never, next)) as Response;
}

describe('src/middleware.ts', () => {
  describe('Origin / Sec-Fetch-Site same-origin check on unsafe methods', () => {
    it('cross-origin Origin header on POST /account/... -> 403', async () => {
      const ctx = makeContext({
        method: 'POST',
        path: '/account/notifications',
        headers: { origin: 'https://evil.example' },
      });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });

    it('same-origin Origin header + valid session + valid csrf token -> passes through to next()', async () => {
      const { id, cookieValue } = await sessionFor(citizenId);
      const token = issueCsrfToken(id);
      const next = nextStub(200);

      const ctx = makeContext({
        method: 'POST',
        path: '/account/notifications',
        headers: { origin: SITE_ORIGIN },
        cookieValue,
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({ csrf_token: token }).toString(),
      });

      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('Sec-Fetch-Site: same-origin passes (no Origin header needed)', async () => {
      const { id, cookieValue } = await sessionFor(citizenId);
      const token = issueCsrfToken(id);
      const next = nextStub(200);

      const ctx = makeContext({
        method: 'POST',
        path: '/account/notifications',
        headers: { 'sec-fetch-site': 'same-origin' },
        cookieValue,
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({ csrf_token: token }).toString(),
      });

      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('Sec-Fetch-Site: cross-site -> 403 even with a same-origin Origin header', async () => {
      const ctx = makeContext({
        method: 'POST',
        path: '/account/notifications',
        headers: { 'sec-fetch-site': 'cross-site', origin: SITE_ORIGIN },
      });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });

    it('neither Origin nor Sec-Fetch-Site present -> 403 (fail closed)', async () => {
      const ctx = makeContext({ method: 'POST', path: '/account/notifications' });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });
  });

  describe('route guards', () => {
    it('unauthenticated GET /account/... -> redirect to /login?next=<validated relative path>', async () => {
      const ctx = makeContext({ path: '/account/submissions?x=1' });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/account/submissions?x=1')}`);
    });

    it('unauthenticated GET /curator -> redirect to /login', async () => {
      const ctx = makeContext({ path: '/curator' });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/curator')}`);
    });

    it('citizen GET /curator -> 403', async () => {
      const { cookieValue } = await sessionFor(citizenId);
      const ctx = makeContext({ path: '/curator', cookieValue });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });

    it('curator GET /curator -> passes through', async () => {
      const { cookieValue } = await sessionFor(curatorId);
      const next = nextStub(200);
      const ctx = makeContext({ path: '/curator', cookieValue });
      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('curator GET /admin -> 403', async () => {
      const { cookieValue } = await sessionFor(curatorId);
      const ctx = makeContext({ path: '/admin', cookieValue });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });

    it('admin GET /curator -> passes through', async () => {
      const { cookieValue } = await sessionFor(adminId);
      const next = nextStub(200);
      const ctx = makeContext({ path: '/curator', cookieValue });
      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('admin GET /admin -> passes through', async () => {
      const { cookieValue } = await sessionFor(adminId);
      const next = nextStub(200);
      const ctx = makeContext({ path: '/admin', cookieValue });
      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  describe('open-redirect defense (isSameOriginRelative)', () => {
    it('an absolute cross-origin URL collapses to /', () => {
      expect(isSameOriginRelative('https://evil.example')).toBe('/');
    });

    it('a protocol-relative URL collapses to /', () => {
      expect(isSameOriginRelative('//evil.example')).toBe('/');
    });

    it('a backslash-based protocol-relative trick collapses to /', () => {
      expect(isSameOriginRelative('/\\evil.example')).toBe('/');
      expect(isSameOriginRelative('\\\\evil.example')).toBe('/');
    });

    it('a same-origin relative path (with query) passes through unchanged', () => {
      expect(isSameOriginRelative('/account/submissions?x=1')).toBe('/account/submissions?x=1');
    });

    it('non-string / empty input collapses to /', () => {
      expect(isSameOriginRelative(undefined)).toBe('/');
      expect(isSameOriginRelative('')).toBe('/');
    });

    // Regression cases for the CRITICAL Task 26 review finding: ASCII
    // tab/CR/LF inside a leading-single-slash string are invisible to plain
    // startsWith()-based checks, but the WHATWG URL parser strips them as
    // its first parsing step, turning `/\t/evil.example` into the
    // protocol-relative `//evil.example` -> `https://evil.example`. The
    // consumer (/login?next=) decodes %09/%0A/%0D back into these exact raw
    // control bytes via URLSearchParams, so this bypass was live.
    describe('control-char bypass regression (Task 26 review, CRITICAL)', () => {
      it('a raw tab immediately after the leading slash collapses to /', () => {
        expect(isSameOriginRelative('/\t/evil.example')).toBe('/');
      });

      it('a raw LF immediately after the leading slash collapses to /', () => {
        expect(isSameOriginRelative('/\n/evil.example')).toBe('/');
      });

      it('a raw CR immediately after the leading slash collapses to /', () => {
        expect(isSameOriginRelative('/\r/evil.example')).toBe('/');
      });

      it('a control char embedded mid-path also collapses to /', () => {
        expect(isSameOriginRelative('/account/\tsubmissions')).toBe('/');
      });

      it('documents that the consumer decodes %09 into a raw tab before calling this function', () => {
        // URLSearchParams (what /login?next= is read through) decodes
        // percent-escapes, so a query string of `next=%09%2Fevil.example`
        // arrives here as the raw control char, not the escaped form.
        expect(isSameOriginRelative(decodeURIComponent('/%09/evil.example'))).toBe('/');
      });
    });

    describe('additional bypass shapes rejected alongside the control-char fix', () => {
      it('a bare scheme + host with no path collapses to /', () => {
        expect(isSameOriginRelative('https://evil.example')).toBe('/');
      });

      it('protocol-relative collapses to /', () => {
        expect(isSameOriginRelative('//evil.example')).toBe('/');
      });

      it('a leading-backslash trick collapses to /', () => {
        expect(isSameOriginRelative('/\\evil.example')).toBe('/');
      });

      it('a javascript: URL collapses to /', () => {
        expect(isSameOriginRelative('javascript:alert(1)')).toBe('/');
      });

      it('an uppercase-scheme absolute URL collapses to /', () => {
        expect(isSameOriginRelative('HTTP://evil')).toBe('/');
      });
    });

    describe('canonicalization preserves genuinely same-origin targets', () => {
      it('a same-origin relative path with a query string round-trips unchanged', () => {
        expect(isSameOriginRelative('/account/submissions?x=1')).toBe('/account/submissions?x=1');
      });

      it('a plain same-origin path round-trips unchanged', () => {
        expect(isSameOriginRelative('/ward/57')).toBe('/ward/57');
      });

      it('a same-origin path with query and hash round-trips unchanged', () => {
        expect(isSameOriginRelative('/ward/57?a=b#c')).toBe('/ward/57?a=b#c');
      });
    });

    // Regression cases for the residual bypass found in adversarial
    // re-review of the Task 26 fix: dot-segment normalization performed BY
    // the URL parser itself can collapse a same-origin-looking input into a
    // pathname that starts with `//`. The origin check on `u.origin` passes
    // (the parser genuinely resolved it against SITE_ORIGIN), but the
    // RECONSTRUCTED string handed back to the caller is protocol-relative,
    // so a downstream `Astro.redirect(next)` / `Location:` header / raw
    // `window.location` assignment gets re-parsed by the browser in
    // isolation as `https://evil.example`. Closed by re-validating the
    // reconstructed `pathname + search + hash` after canonicalization.
    describe('dot-segment-collapsed // pathname bypass (Task 26 re-review)', () => {
      it('a leading /.// dot-segment collapses to /', () => {
        expect(isSameOriginRelative('/.//evil.example')).toBe('/');
      });

      it('a leading /..// dot-segment collapses to /', () => {
        expect(isSameOriginRelative('/..//evil.example')).toBe('/');
      });

      it('a nested /./..// dot-segment collapses to /', () => {
        expect(isSameOriginRelative('/./..//evil.example')).toBe('/');
      });

      it('a trailing-segment /a/..// dot-segment collapses to /', () => {
        expect(isSameOriginRelative('/a/..//evil.example')).toBe('/');
      });

      // Belt-and-suspenders: no adversarial input in our bypass corpus may
      // ever cause this function to return a protocol-relative string. This
      // is a property check over the whole list, not just a spot check —
      // it's the invariant the rest of the codebase (the /login handler)
      // depends on to treat the return value as a safe redirect target.
      it('never returns a string starting with // for any known adversarial input', () => {
        const adversarialInputs = [
          '//evil.example',
          '/\\evil.example',
          '\\\\evil.example',
          'https://evil.example',
          'HTTP://evil',
          'javascript:alert(1)',
          '/\t/evil.example',
          '/\n/evil.example',
          '/\r/evil.example',
          '/account/\tsubmissions',
          '/.//evil.example',
          '/..//evil.example',
          '/./..//evil.example',
          '/a/..//evil.example',
        ];
        for (const input of adversarialInputs) {
          expect(isSameOriginRelative(input).startsWith('//')).toBe(false);
        }
      });
    });
  });

  describe('canEditWard', () => {
    it('admin: true for any ward', async () => {
      expect(await canEditWard(adminId, 'admin', WARD.id)).toBe(true);
      expect(await canEditWard(adminId, 'admin', UNSCOPED_WARD_ID)).toBe(true);
    });

    it('curator: true for a scoped ward', async () => {
      expect(await canEditWard(curatorId, 'curator', WARD.id)).toBe(true);
    });

    it('curator: false for an unscoped ward', async () => {
      expect(await canEditWard(curatorId, 'curator', UNSCOPED_WARD_ID)).toBe(false);
    });

    it('citizen: always false', async () => {
      expect(await canEditWard(citizenId, 'citizen', WARD.id)).toBe(false);
    });
  });

  describe('cache safety: public GETs', () => {
    it("GET / passes through and the response carries no Set-Cookie", async () => {
      const next = nextStub(200);
      const ctx = makeContext({ path: '/' });
      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('a public GET with no session cookie resolves locals.session to null and is not blocked', async () => {
      const ctx = makeContext({ path: '/ward/1' });
      await run(ctx, nextStub(200));
      expect(ctx.locals.session).toBeNull();
    });
  });

  describe('synchronizer CSRF token', () => {
    it('/account POST without a valid token -> 403', async () => {
      const { cookieValue } = await sessionFor(citizenId);
      const ctx = makeContext({
        method: 'POST',
        path: '/account/notifications',
        headers: { origin: SITE_ORIGIN },
        cookieValue,
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({ csrf_token: 'not-the-right-token' }).toString(),
      });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });

    it('/account POST with no token field at all -> 403', async () => {
      const { cookieValue } = await sessionFor(citizenId);
      const ctx = makeContext({
        method: 'POST',
        path: '/account/notifications',
        headers: { origin: SITE_ORIGIN },
        cookieValue,
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({}).toString(),
      });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });

    it('/account POST with a valid issueCsrfToken(sessionId) -> passes the csrf check', async () => {
      const { id, cookieValue } = await sessionFor(citizenId);
      const next = nextStub(200);
      const ctx = makeContext({
        method: 'POST',
        path: '/account/notifications',
        headers: { origin: SITE_ORIGIN },
        cookieValue,
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({ csrf_token: issueCsrfToken(id) }).toString(),
      });
      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('/api/otp/request POST with a good Origin but no csrf field is NOT rejected by the CSRF rule', async () => {
      const next = nextStub(200);
      const ctx = makeContext({
        method: 'POST',
        path: '/api/otp/request',
        headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ destination: 'x@example.com' }),
        contentType: 'application/json',
      });
      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  describe('/api/webhooks/* exemption', () => {
    it('cross-origin POST with no Origin/Sec-Fetch-Site and no session is let through (not 403)', async () => {
      const next = nextStub(200);
      const ctx = makeContext({
        method: 'POST',
        path: '/api/webhooks/sendgrid',
        body: JSON.stringify([{ event: 'bounce' }]),
        contentType: 'application/json',
      });
      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  // Task 48 review / Task 26 bug: prefix checks matched the RAW pathname,
  // so a `/kn/…` twin of a guarded route (`/kn/account`, and defense-in-depth
  // for `/kn/curator`, `/kn/admin` even though those two have no twin today)
  // slipped past the route guard, the synchronizer-token CSRF check, and the
  // noindex header. Fixed by matching against a locale-stripped pathname.
  // These tests exercise the KN-prefixed paths directly against the
  // middleware to prove the prefix match now fires identically to the EN
  // original, and that public `/kn/…` pages remain unguarded/unindexed as
  // before.
  describe('/kn/ locale-twin route guards (Task 48 review, Task 26 bug)', () => {
    it('unauthenticated GET /kn/account/submissions -> redirect to /login?next=<kn path> (guard now fires on the KN twin)', async () => {
      const ctx = makeContext({ path: '/kn/account/submissions?x=1' });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `/login?next=${encodeURIComponent('/kn/account/submissions?x=1')}`,
      );
    });

    it('authenticated GET /kn/account passes through (guard recognizes the session)', async () => {
      const { cookieValue } = await sessionFor(citizenId);
      const next = nextStub(200);
      const ctx = makeContext({ path: '/kn/account', cookieValue });
      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('unauthenticated GET /kn/curator -> redirect to /login (no /kn/curator page exists, but the prefix match must still fire — defense in depth)', async () => {
      const ctx = makeContext({ path: '/kn/curator' });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/kn/curator')}`);
    });

    it('citizen GET /kn/curator -> 403 (wrong role, KN prefix)', async () => {
      const { cookieValue } = await sessionFor(citizenId);
      const ctx = makeContext({ path: '/kn/curator', cookieValue });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });

    it('curator GET /kn/admin -> 403 (wrong role, KN prefix)', async () => {
      const { cookieValue } = await sessionFor(curatorId);
      const ctx = makeContext({ path: '/kn/admin', cookieValue });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });

    it('CSRF: unsafe POST to /kn/account/notifications without a valid token -> 403 (CSRF check now fires on the KN twin)', async () => {
      const { cookieValue } = await sessionFor(citizenId);
      const ctx = makeContext({
        method: 'POST',
        path: '/kn/account/notifications',
        headers: { origin: SITE_ORIGIN },
        cookieValue,
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({}).toString(),
      });
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(403);
    });

    it('CSRF: unsafe POST to /kn/account/notifications with a valid token passes through', async () => {
      const { id, cookieValue } = await sessionFor(citizenId);
      const next = nextStub(200);
      const ctx = makeContext({
        method: 'POST',
        path: '/kn/account/notifications',
        headers: { origin: SITE_ORIGIN },
        cookieValue,
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({ csrf_token: issueCsrfToken(id) }).toString(),
      });
      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it.each(['/kn/partner/some-slug', '/kn/login', '/kn/account'])(
      '%s carries X-Robots-Tag: noindex (KN twin, previously missing)',
      async (path) => {
        const ctx = makeContext({ path });
        const res = await run(ctx, nextStub(200));
        expect(res.headers.get('x-robots-tag')).toBe('noindex');
      },
    );

    it('a public /kn/ page (e.g. /kn/ward/57) is still NOT guarded and NOT noindex (the strip does not over-match)', async () => {
      const next = nextStub(200);
      const ctx = makeContext({ path: '/kn/ward/57' });
      const res = await run(ctx, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(res.headers.get('x-robots-tag')).toBeNull();
      expect(ctx.locals.session).toBeNull();
    });

    it('locals.lang is still "kn" for a /kn/ path after the guard/noindex fix', async () => {
      const ctx = makeContext({ path: '/kn/account' });
      await run(ctx, nextStub(200));
      expect(ctx.locals.lang).toBe('kn');
    });

    it('locals.lang is still "en" for an EN path', async () => {
      const ctx = makeContext({ path: '/account' });
      await run(ctx, nextStub(200));
      expect(ctx.locals.lang).toBe('en');
    });
  });

  describe('X-Robots-Tag: noindex', () => {
    it.each(['/account', '/curator', '/admin', '/login', '/partner/some-slug'])(
      '%s carries X-Robots-Tag: noindex',
      async (path) => {
        const ctx = makeContext({ path });
        const res = await run(ctx, nextStub(200));
        expect(res.headers.get('x-robots-tag')).toBe('noindex');
      },
    );

    it('a normal public page does NOT carry X-Robots-Tag', async () => {
      const ctx = makeContext({ path: '/ward/1' });
      const res = await run(ctx, nextStub(200));
      expect(res.headers.get('x-robots-tag')).toBeNull();
    });

    it('/partner-with-us (not /partner/*) does NOT carry X-Robots-Tag', async () => {
      const ctx = makeContext({ path: '/partner-with-us' });
      const res = await run(ctx, nextStub(200));
      expect(res.headers.get('x-robots-tag')).toBeNull();
    });
  });

  // Task 60: the app (not nginx) emits Content-Security-Policy, built from
  // the SAME per-request nonce this middleware mints into `locals.cspNonce`
  // (src/lib/csp.ts#buildCsp) — src/layouts/Base.astro bakes that exact
  // nonce onto its two inline <script> tags. Proving the response header's
  // nonce equals `ctx.locals.cspNonce` after the same middleware call is the
  // strongest tie-together available without rendering the full HTML here
  // (that byte-identical header/body agreement is additionally exercised at
  // the page level in tests/routes/cache-invariant.test.ts, whose
  // `normalize()` helper explicitly documents relying on this).
  describe('Content-Security-Policy (Task 60, app-emitted, src/lib/csp.ts)', () => {
    it('a public page response carries a CSP header whose nonce matches locals.cspNonce for that same request', async () => {
      const ctx = makeContext({ path: '/ward/1' });
      const res = await run(ctx, nextStub(200));

      const csp = res.headers.get('content-security-policy');
      expect(csp).toBeTruthy();
      expect(typeof ctx.locals.cspNonce).toBe('string');
      expect((ctx.locals.cspNonce as string).length).toBeGreaterThan(0);
      expect(csp).toContain(`'nonce-${ctx.locals.cspNonce}'`);
    });

    it('script-src is present and strict: no unsafe-inline', async () => {
      const ctx = makeContext({ path: '/ward/1' });
      const res = await run(ctx, nextStub(200));
      const csp = res.headers.get('content-security-policy')!;
      const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'));
      expect(scriptSrc).toBeTruthy();
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });

    it('two independent requests to the same path get two different nonces (per-request, not cached/shared)', async () => {
      const ctx1 = makeContext({ path: '/ward/1' });
      const res1 = await run(ctx1, nextStub(200));
      const ctx2 = makeContext({ path: '/ward/1' });
      const res2 = await run(ctx2, nextStub(200));

      expect(ctx1.locals.cspNonce).not.toBe(ctx2.locals.cspNonce);
      expect(res1.headers.get('content-security-policy')).not.toBe(res2.headers.get('content-security-policy'));
    });

    it('anonymous-write pages get the reCAPTCHA relaxation; the ward issues page does not', async () => {
      const partnerCtx = makeContext({ path: '/partner-with-us' });
      const partnerRes = await run(partnerCtx, nextStub(200));
      expect(partnerRes.headers.get('content-security-policy')).toContain('www.google.com');

      const wardCtx = makeContext({ path: '/ward/1' });
      const wardRes = await run(wardCtx, nextStub(200));
      expect(wardRes.headers.get('content-security-policy')).toContain('www.google.com');

      const issuesCtx = makeContext({ path: '/ward/1/issues' });
      const issuesRes = await run(issuesCtx, nextStub(200));
      expect(issuesRes.headers.get('content-security-policy')).not.toContain('www.google.com');
    });

    it('a 403/redirect response still carries the CSP header (set on every response)', async () => {
      const ctx = makeContext({ path: '/curator' }); // unauthenticated -> redirect
      const res = await run(ctx, nextStub());
      expect(res.status).toBe(302);
      expect(res.headers.get('content-security-policy')).toBeTruthy();
    });
  });
});
