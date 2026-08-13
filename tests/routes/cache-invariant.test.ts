/**
 * Cache-invariant + security guard suite (architecture.md §12 NFRs) — the
 * single named enforcement point for the five guarantees that recur across
 * this codebase's individual route suites. Some assertions here re-exercise
 * behavior already covered elsewhere (Task 28/38/53); that duplication is
 * intentional — this file is the one place a reviewer can look to
 * see every §12 guard proven end to end, in one run, against the real DB
 * and the real middleware.
 *
 * GUARDS:
 *   1. PUBLIC GET CACHE-INVARIANCE (the core guarantee, architecture §5):
 *      for `/`, `/ward/{id}`, `/candidate/{slug}`, `/voting-guide/how-to-vote`,
 *      `/about`, `/press` — render once with no Cookie header and once with
 *      a valid `bv_session` cookie for a real logged-in citizen. Assert (a)
 *      neither response sets `Set-Cookie`, and (b) the HTML bodies are
 *      byte-identical (modulo the expected per-request CSP nonce, which is
 *      normalized out the same way tests/routes/layout.test.ts strips the
 *      container API's own debug attributes — nginx's microcache stores the
 *      whole response as one unit, so a real deployment never needs a
 *      cached body's nonce to match a fresh one).
 *   2. NO-STORE ON NON-PUBLIC ROUTES: `/api/me`, `/account`, `/curator`,
 *      `/admin` all respond with a `cache-control` header containing
 *      `no-store`.
 *   3. UNAPPROVED NEWS ABSENT: a `suggested` (unapproved) news link seeded
 *      on a real candidate never appears in that candidate's public HTML —
 *      `listNewsLinks(id, { approvedOnly: true })` holds end to end.
 *   4. WEBHOOKS REJECT UNSIGNED: `/api/webhooks/sendgrid` and
 *      `/api/webhooks/twilio` 403 an invalid/missing signature and write no
 *      suppression row.
 *   5. MEDIA VALIDATION: `storeMedia` (the single validation point behind
 *      every curator upload path — src/lib/curator.ts) rejects an oversize
 *      file and an off-type (SVG masquerading as an image) file.
 *
 * Drives every public/authenticated page through the REAL middleware
 * (src/middleware.ts) composed with the real page twin via Astro's
 * container API — same technique as tests/routes/account.test.ts /
 * tests/routes/curator.test.ts. Sessions are minted with the real
 * `createSession` (src/lib/session.ts), same as the account/otp suites.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import crypto from 'node:crypto';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { onRequest } from '../../src/middleware';
import { storeMedia, MEDIA_LIMITS } from '../../src/lib/media';

import IndexPage from '../../src/pages/index.astro';
import WardPage from '../../src/pages/ward/[id].astro';
import CandidatePage from '../../src/pages/candidate/[slug].astro';
import HowToVotePage from '../../src/pages/voting-guide/how-to-vote.astro';
import AboutPage from '../../src/pages/about.astro';
import PressPage from '../../src/pages/press.astro';
import * as WardBoundaryRoute from '../../src/pages/ward/[id]/boundary.json';
import { loadWardPolygons, wardForPoint } from '../../src/lib/geo';

import AccountPage from '../../src/pages/account/index.astro';
import CuratorIndexPage from '../../src/pages/curator/index.astro';
import AdminIndexPage from '../../src/pages/admin/index.astro';
import * as meRoute from '../../src/pages/api/me';
import { POST as sendgridPOST } from '../../src/pages/api/webhooks/sendgrid';
import { POST as twilioPOST } from '../../src/pages/api/webhooks/twilio';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const SITE_URL = new URL(SITE_ORIGIN);

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-58-owned id range — clear of every other route suite's fixture
// ids (see e.g. tests/routes/account.test.ts / tests/unit/metrics.test.ts's
// own "owns Nxxx" comments; 99938-99939 is the first free block after
// metrics.test.ts's 99930-99937).
const WARD = {
  id: 99938,
  nameEn: 'Cache Invariant Guard Test Ward',
  nameKn: 'ಸಂಗ್ರಹ ಅಸ್ಥಿರ ರಕ್ಷಣಾ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone CI',
  boundaryRef: 'cache-invariant-guard-test-ward',
};

const CANDIDATE_SLUG = 'cache-invariant-guard-candidate';
const APPROVED_NEWS_URL = 'https://news.example.com/cache-invariant-approved';
const APPROVED_NEWS_TITLE = 'Approved coverage — must appear';
const SUGGESTED_NEWS_URL = 'https://news.example.com/cache-invariant-suggested';
const SUGGESTED_NEWS_TITLE = 'Suggested unapproved coverage — must NEVER appear';

const CITIZEN_EMAIL = 'cache-invariant-citizen@example.test';
const CURATOR_EMAIL = 'cache-invariant-curator@example.test';
const ADMIN_EMAIL = 'cache-invariant-admin@example.test';
const FIXTURE_EMAILS = [CITIZEN_EMAIL, CURATOR_EMAIL, ADMIN_EMAIL];

const WEBHOOK_BOUNCE_EMAIL = 'cache-invariant-webhook-bounce@example.test';
const WEBHOOK_STOP_PHONE = '+919999888058';

// Task-58-owned actor id for the storeMedia guard (well clear of every other
// suite's userId fixtures, which are all real inserted users under 99938).
const MEDIA_ACTOR = { userId: 88058 };

let candidateId: number;

async function upsertUser(email: string, extra: Partial<typeof schema.users.$inferInsert> = {}): Promise<number> {
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (existing) {
    await db.update(schema.users).set(extra).where(eq(schema.users.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(schema.users)
    .values({ email, status: 'active', ...extra })
    .returning({ id: schema.users.id });
  return row!.id;
}

async function sessionFor(userId: number): Promise<string> {
  const { cookieValue } = await createSession(userId);
  return cookieValue;
}

/** Same Twilio request-signature algorithm as src/pages/api/webhooks/twilio.ts / tests/routes/webhooks.test.ts's `computeTwilioSignature` — sorted param names, URL + name+value concatenated, HMAC-SHA1 base64. */
function computeTwilioSignature(authToken: string, url: string, params: URLSearchParams): string {
  const sortedNames = [...params.keys()].sort();
  let signedString = url;
  for (const name of sortedNames) {
    signedString += name + (params.get(name) ?? '');
  }
  return crypto.createHmac('sha1', authToken).update(signedString, 'utf8').digest('base64');
}

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

/**
 * Strips the container API's dev-mode debug attributes AND the per-request
 * CSP nonce (architecture §13 — one of exactly two allowed nonce'd inline
 * scripts is on every page) before comparing bodies. The nonce is EXPECTED
 * to differ between two independent `onRequest` calls (it's freshly random
 * per request — src/middleware.ts) even when nothing else about the page
 * varies; nginx's microcache stores the whole response (headers+body) as
 * one unit, so a cache HIT never needs a stored body's nonce to match a
 * fresh one (see src/layouts/Base.astro's cache-safety docstring). Every
 * OTHER byte must still match — this only neutralizes the one intentionally
 * per-request value.
 */
function normalize(html: string): string {
  return html
    .replace(/\s+data-astro-cid-\w+/g, '')
    .replace(/\s+data-astro-(?:source-file|source-loc)="[^"]*"/g, '')
    .replace(/nonce="[^"]*"/g, 'nonce="NORMALIZED"')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+/g, ' ');
}

/**
 * Drives a request through the REAL middleware (src/middleware.ts) and then
 * the real page/route twin — the same composition production uses (see
 * tests/routes/account.test.ts's `run` for the same pattern, generalized
 * here to cover pages with route params).
 */
async function renderThroughMiddleware(
  page: unknown,
  path: string,
  opts: {
    cookieValue?: string;
    params?: Record<string, string>;
    method?: string;
    /**
     * 'endpoint' for API routes (a module exporting GET/POST/etc., e.g.
     * `src/pages/api/me.ts`) — the container API renders these via
     * `renderEndpoint` rather than the page-component path. Defaults to
     * 'page'. See the container API's own docstring
     * (node_modules/astro/dist/container/index.d.ts): "Useful in case
     * you're attempting to render an endpoint: renderToString(Endpoint,
     * { routeType: 'endpoint' })".
     */
    routeType?: 'page' | 'endpoint';
  } = {},
): Promise<Response> {
  const { cookieValue, params, method, routeType } = opts;
  const url = new URL(path, SITE_URL);

  const headers = new Headers();
  if (cookieValue) headers.set('cookie', `${SESSION_COOKIE}=${cookieValue}`);
  const request = new Request(url, { method, headers });

  const cookiesStub = {
    get: (name: string) => (name === SESSION_COOKIE && cookieValue ? { value: cookieValue } : undefined),
  };
  const locals: Record<string, unknown> = {};
  const ctx = { request, url, site: SITE_URL, cookies: cookiesStub, locals } as any;

  const container = await makeContainer();
  const next = async () =>
    container.renderToResponse(page as any, {
      partial: false,
      request,
      params,
      routeType,
      locals: locals as unknown as App.Locals,
    });

  return (await onRequest(ctx, next)) as Response;
}

describe('§12 cache-invariant + security guard suite', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });

    const [existingCandidate] = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(eq(schema.candidates.slug, CANDIDATE_SLUG));
    if (existingCandidate) {
      await db.delete(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, existingCandidate.id));
      await db.delete(schema.candidates).where(eq(schema.candidates.id, existingCandidate.id));
    }

    const [candidateRow] = await db
      .insert(schema.candidates)
      .values({
        slug: CANDIDATE_SLUG,
        wardId: WARD.id,
        nameEn: 'Cache Invariant Guard Test Candidate',
        nameKn: 'ಸಂಗ್ರಹ ಅಸ್ಥಿರ ರಕ್ಷಣಾ ಪರೀಕ್ಷಾ ಅಭ್ಯರ್ಥಿ',
        partyEn: 'Independent',
        status: 'contesting',
      })
      .returning({ id: schema.candidates.id });
    candidateId = candidateRow!.id;

    await db.insert(schema.candidateNewsLinks).values([
      {
        candidateId,
        url: APPROVED_NEWS_URL,
        title: APPROVED_NEWS_TITLE,
        domain: 'news.example.com',
        origin: 'curator',
        status: 'approved',
      },
      {
        candidateId,
        url: SUGGESTED_NEWS_URL,
        title: SUGGESTED_NEWS_TITLE,
        domain: 'news.example.com',
        origin: 'auto',
        status: 'suggested',
      },
    ]);

    await upsertUser(CITIZEN_EMAIL, { role: 'citizen' });
    await upsertUser(CURATOR_EMAIL, { role: 'curator' });
    await upsertUser(ADMIN_EMAIL, { role: 'admin' });

    await db.delete(schema.suppressions).where(
      inArray(schema.suppressions.contact, [WEBHOOK_BOUNCE_EMAIL, WEBHOOK_STOP_PHONE]),
    );
  });

  afterAll(async () => {
    await db.delete(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));
    await db.delete(schema.candidates).where(eq(schema.candidates.id, candidateId));

    const fixtureUsers = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.email, FIXTURE_EMAILS));
    const ids = fixtureUsers.map((u) => u.id);
    if (ids.length > 0) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
    }
    await db.delete(schema.users).where(inArray(schema.users.email, FIXTURE_EMAILS));

    await db.delete(schema.suppressions).where(
      inArray(schema.suppressions.contact, [WEBHOOK_BOUNCE_EMAIL, WEBHOOK_STOP_PHONE]),
    );

    await client.end();
  });

  // -------------------------------------------------------------------------
  // Guard 1: public GET cache-invariance
  // -------------------------------------------------------------------------
  describe('Guard 1 — public GET cache-invariance (architecture §5)', () => {
    const pages: Array<{ name: string; page: unknown; path: string; params?: Record<string, string> }> = [
      { name: '/', page: IndexPage, path: '/' },
      { name: '/ward/{id}', page: WardPage, path: `/ward/${WARD.id}`, params: { id: String(WARD.id) } },
      {
        name: '/candidate/{slug}',
        page: CandidatePage,
        path: `/candidate/${CANDIDATE_SLUG}`,
        params: { slug: CANDIDATE_SLUG },
      },
      { name: '/voting-guide/how-to-vote', page: HowToVotePage, path: '/voting-guide/how-to-vote' },
      { name: '/about', page: AboutPage, path: '/about' },
      { name: '/press', page: PressPage, path: '/press' },
    ];

    it.each(pages)(
      '$name: no Set-Cookie in either case, byte-identical anonymous vs. session-cookie render',
      async ({ page, path, params }) => {
        const cookieValue = await sessionFor(await upsertUser(CITIZEN_EMAIL, { role: 'citizen' }));

        const anonRes = await renderThroughMiddleware(page, path, { params });
        const authedRes = await renderThroughMiddleware(page, path, { params, cookieValue });

        expect(anonRes.status).toBe(200);
        expect(authedRes.status).toBe(200);

        expect(anonRes.headers.get('set-cookie')).toBeNull();
        expect(authedRes.headers.get('set-cookie')).toBeNull();

        const anonHtml = normalize(await anonRes.text());
        const authedHtml = normalize(await authedRes.text());
        expect(authedHtml).toBe(anonHtml);
      },
    );

    // A route module (src/pages/ward/[id]/boundary.json.ts), not an .astro
    // page, so it renders through the container API's 'endpoint' path
    // (routeType: 'endpoint' — see renderThroughMiddleware's docstring) and
    // is exercised separately from the it.each table above rather than
    // folded into it. Its wardId comes from the in-memory geo index
    // (src/lib/geo.ts), not the Postgres `WARD` fixture the other Guard 1
    // cases use — this route never touches the database.
    it('/ward/{id}/boundary.json: no Set-Cookie in either case, byte-identical anonymous vs. session-cookie render', async () => {
      await loadWardPolygons();
      const boundaryWardId = wardForPoint(12.9716, 77.5946); // central Bengaluru
      expect(boundaryWardId).not.toBeNull();

      const cookieValue = await sessionFor(await upsertUser(CITIZEN_EMAIL, { role: 'citizen' }));
      const params = { id: String(boundaryWardId) };
      const path = `/ward/${boundaryWardId}/boundary.json`;

      const anonRes = await renderThroughMiddleware(WardBoundaryRoute, path, { params, routeType: 'endpoint' });
      const authedRes = await renderThroughMiddleware(WardBoundaryRoute, path, {
        params,
        cookieValue,
        routeType: 'endpoint',
      });

      expect(anonRes.status).toBe(200);
      expect(authedRes.status).toBe(200);

      expect(anonRes.headers.get('set-cookie')).toBeNull();
      expect(authedRes.headers.get('set-cookie')).toBeNull();

      const anonBody = await anonRes.text();
      const authedBody = await authedRes.text();
      expect(authedBody).toBe(anonBody);
    });
  });

  // -------------------------------------------------------------------------
  // Guard 2: no-store on non-public routes
  // -------------------------------------------------------------------------
  describe('Guard 2 — no-store on non-public routes', () => {
    it('GET /api/me (anonymous) -> cache-control contains no-store', async () => {
      // Routed through the SAME real-middleware path (onRequest + the
      // container API) as the /account, /curator, /admin checks below,
      // rather than a hand-built `{ locals: { session: null } }` context, so
      // this also catches a middleware-level cache-control override — not
      // just a regression in the handler's own JSON_HEADERS
      // (src/pages/api/me.ts). `routeType: 'endpoint'` tells the container
      // API to render the module's exported GET rather than treat it as a
      // page component (see renderThroughMiddleware's docstring above). The
      // handler-level unit coverage (anonymous/authed shapes, no PII) stays
      // in tests/routes/me.test.ts; this is only the cache-control guard.
      const res = await renderThroughMiddleware(meRoute, '/api/me', { routeType: 'endpoint' });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('no-store');
    });

    it('GET /account as a signed-in citizen -> cache-control contains no-store', async () => {
      const userId = await upsertUser(CITIZEN_EMAIL, { role: 'citizen' });
      const cookieValue = await sessionFor(userId);
      const res = await renderThroughMiddleware(AccountPage, '/account', { cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('no-store');
    });

    it('GET /curator as a signed-in curator -> cache-control contains no-store', async () => {
      const userId = await upsertUser(CURATOR_EMAIL, { role: 'curator' });
      const cookieValue = await sessionFor(userId);
      const res = await renderThroughMiddleware(CuratorIndexPage, '/curator', { cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('no-store');
    });

    it('GET /admin as a signed-in admin -> cache-control contains no-store', async () => {
      const userId = await upsertUser(ADMIN_EMAIL, { role: 'admin' });
      const cookieValue = await sessionFor(userId);
      const res = await renderThroughMiddleware(AdminIndexPage, '/admin', { cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('no-store');
    });
  });

  // -------------------------------------------------------------------------
  // Guard 3: unapproved news absent from public HTML
  // -------------------------------------------------------------------------
  describe('Guard 3 — unapproved (suggested) news links never reach public HTML', () => {
    it('the candidate page renders the approved link but never the suggested one', async () => {
      const res = await renderThroughMiddleware(CandidatePage, `/candidate/${CANDIDATE_SLUG}`, {
        params: { slug: CANDIDATE_SLUG },
      });
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain(APPROVED_NEWS_URL);
      expect(html).toContain(APPROVED_NEWS_TITLE);

      expect(html).not.toContain(SUGGESTED_NEWS_URL);
      expect(html).not.toContain(SUGGESTED_NEWS_TITLE);
    });
  });

  // -------------------------------------------------------------------------
  // Guard 4: webhooks reject unsigned/invalid requests
  // -------------------------------------------------------------------------
  describe('Guard 4 — webhooks reject unsigned requests (Task 53)', () => {
    it('POST /api/webhooks/sendgrid with no signature headers -> 403, no suppression written', async () => {
      const body = JSON.stringify([{ event: 'bounce', email: WEBHOOK_BOUNCE_EMAIL }]);
      const res = await sendgridPOST({
        request: new Request(`${SITE_ORIGIN}/api/webhooks/sendgrid`, { method: 'POST', body }),
      } as any);

      expect(res.status).toBe(403);

      const [row] = await db
        .select()
        .from(schema.suppressions)
        .where(eq(schema.suppressions.contact, WEBHOOK_BOUNCE_EMAIL));
      expect(row).toBeUndefined();
    });

    it('POST /api/webhooks/sendgrid with a tampered signature -> 403, no suppression written', async () => {
      const originalKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

      try {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const body = JSON.stringify([{ event: 'bounce', email: WEBHOOK_BOUNCE_EMAIL }]);
        // Sign a DIFFERENT body so the signature doesn't verify against what's sent.
        const sign = crypto.createSign('sha256');
        sign.update(timestamp + JSON.stringify([{ event: 'bounce', email: 'someone-else@example.test' }]));
        sign.end();
        const signature = sign.sign(privateKey, 'base64');

        const res = await sendgridPOST({
          request: new Request(`${SITE_ORIGIN}/api/webhooks/sendgrid`, {
            method: 'POST',
            headers: {
              'x-twilio-email-event-webhook-signature': signature,
              'x-twilio-email-event-webhook-timestamp': timestamp,
            },
            body,
          }),
        } as any);

        expect(res.status).toBe(403);
      } finally {
        if (originalKey === undefined) delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
        else process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = originalKey;
      }

      const [row] = await db
        .select()
        .from(schema.suppressions)
        .where(eq(schema.suppressions.contact, WEBHOOK_BOUNCE_EMAIL));
      expect(row).toBeUndefined();
    });

    it('POST /api/webhooks/twilio with no signature header -> 403, no suppression written', async () => {
      const originalToken = process.env.TWILIO_AUTH_TOKEN;
      process.env.TWILIO_AUTH_TOKEN = 'cache-invariant-test-token';
      try {
        const params = new URLSearchParams({ From: `whatsapp:${WEBHOOK_STOP_PHONE}`, Body: 'STOP' });
        const res = await twilioPOST({
          request: new Request('https://bengaluruvotes.opencity.in/api/webhooks/twilio', {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              host: 'bengaluruvotes.opencity.in',
              'x-forwarded-proto': 'https',
            },
            body: params.toString(),
          }),
        } as any);
        expect(res.status).toBe(403);
      } finally {
        if (originalToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
        else process.env.TWILIO_AUTH_TOKEN = originalToken;
      }

      const [row] = await db
        .select()
        .from(schema.suppressions)
        .where(eq(schema.suppressions.contact, WEBHOOK_STOP_PHONE));
      expect(row).toBeUndefined();
    });

    it('POST /api/webhooks/twilio with a wrong signature -> 403, no suppression written', async () => {
      const originalToken = process.env.TWILIO_AUTH_TOKEN;
      process.env.TWILIO_AUTH_TOKEN = 'cache-invariant-test-token';
      try {
        const url = 'https://bengaluruvotes.opencity.in/api/webhooks/twilio';
        const params = new URLSearchParams({ From: `whatsapp:${WEBHOOK_STOP_PHONE}`, Body: 'STOP' });
        const wrongSignature = computeTwilioSignature('a-completely-different-token', url, params);

        const res = await twilioPOST({
          request: new Request(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              host: 'bengaluruvotes.opencity.in',
              'x-forwarded-proto': 'https',
              'x-twilio-signature': wrongSignature,
            },
            body: params.toString(),
          }),
        } as any);
        expect(res.status).toBe(403);
      } finally {
        if (originalToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
        else process.env.TWILIO_AUTH_TOKEN = originalToken;
      }

      const [row] = await db
        .select()
        .from(schema.suppressions)
        .where(eq(schema.suppressions.contact, WEBHOOK_STOP_PHONE));
      expect(row).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Guard 5: media validation (size + magic-byte type)
  // -------------------------------------------------------------------------
  describe('Guard 5 — media validation rejects oversize and off-type uploads (src/lib/media.ts)', () => {
    it('rejects a photo over the 2 MB cap with media_too_large, before any type check', async () => {
      const oversized = Buffer.alloc(MEDIA_LIMITS.photo + 1, 0);
      // Give it a valid PNG magic-byte prefix so this is purely a size
      // rejection, not conflated with the type guard below.
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversized);

      await expect(storeMedia(MEDIA_ACTOR, { bytes: oversized }, 'photo')).rejects.toThrow('media_too_large');
    });

    it('rejects an off-type upload — an SVG masquerading as a photo — with unsupported_media_type', async () => {
      const svgBytes = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

      await expect(
        storeMedia(MEDIA_ACTOR, { bytes: svgBytes, declaredType: 'image/png' }, 'photo'),
      ).rejects.toThrow('unsupported_media_type');
    });

    it('rejects an affidavit upload over the 20 MB cap with media_too_large', async () => {
      const oversized = Buffer.alloc(MEDIA_LIMITS.affidavit + 1, 0);
      Buffer.from('%PDF-1.4\n').copy(oversized);

      await expect(storeMedia(MEDIA_ACTOR, { bytes: oversized }, 'affidavit')).rejects.toThrow('media_too_large');
    });
  });
});
