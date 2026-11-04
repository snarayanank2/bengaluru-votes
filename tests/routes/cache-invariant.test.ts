/**
 * Cache-invariant + security guard suite (architecture.md §12 NFRs) — the
 * single named enforcement point for the guarantees that recur across
 * this codebase's individual route suites. Some assertions here re-exercise
 * behavior already covered elsewhere (Task 28/38/53); that duplication is
 * intentional — this file is the one place a reviewer can look to
 * see every §12 guard proven end to end, in one run, against the real DB
 * and the real middleware.
 *
 * GUARDS:
 *   1. PUBLIC GET CACHE-INVARIANCE (the core guarantee, architecture §5):
 *      for `/`, `/ward/{id}`, `/candidate/{slug}`, `/voter-faqs`,
 *      `/about` — render once with no Cookie header and once with
 *      a valid `bv_session` cookie for a real signed-in staff member. Assert (a)
 *      neither response sets `Set-Cookie`, and (b) the HTML bodies are
 *      byte-identical (modulo the expected per-request CSP nonce, which is
 *      normalized out the same way tests/routes/layout.test.ts strips the
 *      container API's own debug attributes — nginx's microcache stores the
 *      whole response as one unit, so a real deployment never needs a
 *      cached body's nonce to match a fresh one).
 *   2. NO-STORE ON NON-PUBLIC ROUTES: `/curator` and `/admin` respond
 *      with a `cache-control` header containing `no-store`.
 *   3. (removed with the candidate news-link feature, 2026-10-13.)
 *   4. (removed with the SendGrid/Twilio webhooks.)
 *   5. MEDIA VALIDATION: `storeMedia` (the single validation point behind
 *      every curator upload path — src/lib/curator.ts) rejects an oversize
 *      file and an off-type (SVG masquerading as an image) file.
 *
 * Drives every public/authenticated page through the REAL middleware
 * (src/middleware.ts) composed with the real page twin via Astro's
 * container API — same technique as tests/routes/curator.test.ts.
 * Sessions are minted with the real `createSession` (src/lib/session.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { onRequest } from '../../src/middleware';
import { storeMedia, MEDIA_MAX_BYTES } from '../../src/lib/media';

import IndexPage from '../../src/pages/index.astro';
import WardPage from '../../src/pages/ward/[id].astro';
import CandidatePage from '../../src/pages/candidate/[slug].astro';
import VoterFaqsPage from '../../src/pages/voter-faqs.astro';
import AboutPage from '../../src/pages/about.astro';
import * as WardBoundaryRoute from '../../src/pages/ward/[id]/boundary.json';
import { loadWardPolygons, wardForPoint } from '../../src/lib/geo';

import CuratorIndexPage from '../../src/pages/curator/index.astro';
import AdminIndexPage from '../../src/pages/admin/index.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const SITE_URL = new URL(SITE_ORIGIN);

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-58-owned id range — clear of every other route suite's fixture
// ids (see e.g. tests/unit/metrics.test.ts's
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


const CURATOR_EMAIL = 'cache-invariant-curator@example.test';
const ADMIN_EMAIL = 'cache-invariant-admin@example.test';
const FIXTURE_EMAILS = [CURATOR_EMAIL, ADMIN_EMAIL];

// Task-58-owned actor id for the storeMedia guard (well clear of every other
// suite's userId fixtures, which are all real inserted users under 99938).
const MEDIA_ACTOR = { userId: 88058 };

let candidateId: number;

async function upsertUser(email: string, extra: { role: 'transcriber' | 'curator' | 'admin' }): Promise<number> {
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
 * tests/routes/curator.test.ts for the same pattern, generalized here to
 * cover pages with route params).
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
     * `src/pages/ward/[id]/boundary.json.ts`) — the container API renders these via
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
      await db.delete(schema.candidates).where(eq(schema.candidates.id, existingCandidate.id));
    }

    const [candidateRow] = await db
      .insert(schema.candidates)
      .values({
        slug: CANDIDATE_SLUG,
        wardId: WARD.id,
        nameEn: 'Cache Invariant Guard Test Candidate',
        partyEn: 'Independent',
        status: 'contesting',
      })
      .returning({ id: schema.candidates.id });
    candidateId = candidateRow!.id;

    await upsertUser(CURATOR_EMAIL, { role: 'curator' });
    await upsertUser(ADMIN_EMAIL, { role: 'admin' });
  });

  afterAll(async () => {
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
      { name: '/voter-faqs', page: VoterFaqsPage, path: '/voter-faqs' },
      { name: '/about', page: AboutPage, path: '/about' },
    ];

    it.each(pages)(
      '$name: no Set-Cookie in either case, byte-identical anonymous vs. session-cookie render',
      async ({ page, path, params }) => {
        const cookieValue = await sessionFor(await upsertUser(CURATOR_EMAIL, { role: 'curator' }));

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

      const cookieValue = await sessionFor(await upsertUser(CURATOR_EMAIL, { role: 'curator' }));
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
  // Guard 5: media validation (size + magic-byte type)
  // -------------------------------------------------------------------------
  describe('Guard 5 — media validation rejects oversize and off-type uploads (src/lib/media.ts)', () => {
    it('rejects an off-type upload — an SVG masquerading as a PDF — with unsupported_media_type', async () => {
      const svgBytes = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

      await expect(
        storeMedia(MEDIA_ACTOR, { bytes: svgBytes, declaredType: 'application/pdf' }),
      ).rejects.toThrow('unsupported_media_type');
    });

    it('rejects an affidavit upload over the 20 MB cap with media_too_large', async () => {
      const oversized = Buffer.alloc(MEDIA_MAX_BYTES + 1, 0);
      Buffer.from('%PDF-1.4\n').copy(oversized);

      await expect(storeMedia(MEDIA_ACTOR, { bytes: oversized })).rejects.toThrow('media_too_large');
    });
  });
});
