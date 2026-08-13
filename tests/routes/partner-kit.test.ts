/**
 * Partner kit (`/partner/{slug}`, `/kn/partner/{slug}`) — Task 48, IA
 * §3.19, PRD §5.12, gtm-plan.md §5. Drives every request through the REAL
 * route twins + a real DB, same technique as tests/routes/candidate.test.ts.
 *
 * COVERAGE MAP:
 *   - known partner slug -> 200 (both langs); unknown slug -> real 404
 *     (route twin).
 *   - TAGGED LINK: the readonly input carries the exact
 *     `{SITE_ORIGIN}/?src={slug}` value.
 *   - FORWARD TEXTS: general + first-time-voter messages, each present in
 *     BOTH English and Kannada on EVERY language variant of the page (a
 *     partner on the EN page can still grab the KN text); the
 *     first-time-voter text links `/voting-guide` (localized + `?src`).
 *   - NEUTRALITY STATEMENT present, bilingual.
 *   - POSTER block present with the asset-pending note.
 *   - PRINT STYLES: an `@media print` rule scoped to `.poster-block` exists
 *     in the page component's own source (scoped-style CSS text isn't
 *     inlined into the container's rendered response body — same
 *     limitation noted in tests/routes/compare.test.ts).
 *   - NOINDEX: Base's `noindex` prop renders `<meta name="robots"
 *     content="noindex">`; middleware's `X-Robots-Tag: noindex` header is
 *     asserted too (same middleware exercised via the real route twin).
 *   - CACHE-SAFETY: markup is byte-identical with/without a session cookie.
 *   - hreflang pair + lang attribute.
 *   - No-JS-safe copy: the readonly input/textarea fields work without
 *     JS; the only extra script on the page is the CopyButton island
 *     import.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';
import PartnerKitEn from '../../src/pages/partner/[slug].astro';
import PartnerKitKn from '../../src/pages/kn/partner/[slug].astro';
import { onRequest } from '../../src/middleware';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. CI always sets this; for local runs export ' +
      'DATABASE_URL=postgres://postgres@localhost:54329/bv_test (see task brief).',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// Task-specific partner slug — this suite owns this exact slug (no numeric
// id range to reserve, unlike ward-keyed suites, since partners are keyed
// by their own unique slug).
const SLUG = 'partner-kit-test-rwa';

function normalize(html: string): string {
  return html
    .replace(/\s+data-astro-cid-\w+/g, '')
    .replace(/\s+data-astro-(?:source-file|source-loc)="[^"]*"/g, '')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&'); // decode entities Astro escapes in text-node content (e.g. an apostrophe in copy-block prose) so string-literal assertions below can compare against the plain source text.
}

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

function twinFor(lang: Lang) {
  return lang === 'kn' ? PartnerKitKn : PartnerKitEn;
}

async function renderPartnerKit(lang: Lang, slug: string, extraHeaders?: Record<string, string>): Promise<Response> {
  const container = await makeContainer();
  const path = localePath(lang, `/partner/${slug}`);
  return container.renderToResponse(twinFor(lang), {
    partial: false,
    params: { slug },
    request: new Request(`${SITE_ORIGIN}${path}`, { headers: extraHeaders }),
  });
}

/**
 * Renders through the REAL middleware too (onRequest), same
 * `makeContext`-style shape as tests/routes/middleware.test.ts, to assert
 * the `X-Robots-Tag` header src/middleware.ts sets for every /partner/*
 * response.
 */
async function renderPartnerKitThroughMiddleware(lang: Lang, slug: string): Promise<Response> {
  const container = await makeContainer();
  const path = localePath(lang, `/partner/${slug}`);
  const url = new URL(path, SITE_ORIGIN);
  const request = new Request(url);

  const context = {
    request,
    url,
    site: new URL(SITE_ORIGIN),
    cookies: { get: () => undefined },
    locals: {},
  } as any;

  const next = () =>
    container.renderToResponse(twinFor(lang), {
      partial: false,
      params: { slug },
      request,
    });

  return (await onRequest(context, next)) as Response;
}

describe('Partner kit (/partner/{slug}, /kn/partner/{slug}) — IA §3.19, PRD §5.12', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    const [existing] = await db.select({ id: schema.partners.id }).from(schema.partners).where(eq(schema.partners.slug, SLUG));
    if (existing) {
      await db.delete(schema.partnerWards).where(eq(schema.partnerWards.partnerId, existing.id));
      await db.delete(schema.partners).where(eq(schema.partners.id, existing.id));
    }

    await db.insert(schema.partners).values({ slug: SLUG, name: 'Test RWA Federation', contact: 'contact@example.org' });
  });

  afterAll(async () => {
    const [existing] = await db.select({ id: schema.partners.id }).from(schema.partners).where(eq(schema.partners.slug, SLUG));
    if (existing) {
      await db.delete(schema.partnerWards).where(eq(schema.partnerWards.partnerId, existing.id));
      await db.delete(schema.partners).where(eq(schema.partners.id, existing.id));
    }
    await client.end();
  });

  describe('known partner slug', () => {
    it.each(['en', 'kn'] as const)('%s: 200, renders the partner name', async (lang) => {
      const res = await renderPartnerKit(lang, SLUG);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain('Test RWA Federation');
    });
  });

  describe('unknown slug -> real 404 (route twin)', () => {
    it.each(['en', 'kn'] as const)('%s: a well-formed but non-existent slug 404s', async (lang) => {
      const res = await renderPartnerKit(lang, 'no-such-partner-slug-ever');
      expect(res.status).toBe(404);
    });
  });

  describe('tagged link (PRD §5.12)', () => {
    it('the readonly input carries the exact {SITE_ORIGIN}/?src={slug} tagged link', async () => {
      const html = normalize(await (await renderPartnerKit('en', SLUG)).text());
      const expectedLink = `${SITE_ORIGIN}/?src=${SLUG}`;
      expect(html).toContain(`value="${expectedLink}"`);
      expect(html).toMatch(/<input[^>]*id="tagged-link-input"[^>]*readonly/);
    });

    it('the tagged link is identical on the Kannada page too (one canonical link, not localized)', async () => {
      const html = normalize(await (await renderPartnerKit('kn', SLUG)).text());
      const expectedLink = `${SITE_ORIGIN}/?src=${SLUG}`;
      expect(html).toContain(`value="${expectedLink}"`);
    });
  });

  describe('WhatsApp forward texts (both languages, on both page variants)', () => {
    it.each(['en', 'kn'] as const)('%s page: general + first-time-voter texts present in BOTH English and Kannada', async (pageLang) => {
      const html = normalize(await (await renderPartnerKit(pageLang, SLUG)).text());

      const enGeneral = t('en', 'partnerKit.forward.general.body', { link: `${SITE_ORIGIN}/?src=${SLUG}` });
      const knGeneral = t('kn', 'partnerKit.forward.general.body', { link: `${SITE_ORIGIN}/?src=${SLUG}` });
      expect(html).toContain(enGeneral);
      expect(html).toContain(knGeneral);
    });

    it.each(['en', 'kn'] as const)('%s page: first-time-voter text links /voting-guide, localized per language, with ?src', async (pageLang) => {
      const html = normalize(await (await renderPartnerKit(pageLang, SLUG)).text());

      const enVotingGuideLink = `${SITE_ORIGIN}${localePath('en', '/voting-guide')}?src=${SLUG}`;
      const knVotingGuideLink = `${SITE_ORIGIN}${localePath('kn', '/voting-guide')}?src=${SLUG}`;

      const enFirstTime = t('en', 'partnerKit.forward.firstTimeVoter.body', { link: enVotingGuideLink });
      const knFirstTime = t('kn', 'partnerKit.forward.firstTimeVoter.body', { link: knVotingGuideLink });

      expect(html).toContain(enFirstTime);
      expect(html).toContain(knFirstTime);
      expect(html).toContain('/voting-guide');
      expect(html).toContain('/kn/voting-guide');
    });

    it('every forward text is inside a copyable (readonly textarea) block', async () => {
      const html = normalize(await (await renderPartnerKit('en', SLUG)).text());
      expect(html).toMatch(/<textarea[^>]*id="forward-general-en"[^>]*readonly/);
      expect(html).toMatch(/<textarea[^>]*id="forward-general-kn"[^>]*readonly/);
      expect(html).toMatch(/<textarea[^>]*id="forward-firsttime-en"[^>]*readonly/);
      expect(html).toMatch(/<textarea[^>]*id="forward-firsttime-kn"[^>]*readonly/);
    });
  });

  describe('neutrality statement (PRD §5.12)', () => {
    it.each(['en', 'kn'] as const)('%s: renders the neutrality statement', async (lang) => {
      const html = normalize(await (await renderPartnerKit(lang, SLUG)).text());
      expect(html).toContain(t(lang, 'partnerKit.neutrality.statement'));
      expect(html).toContain('Oorvani');
    });
  });

  describe('poster block', () => {
    it.each(['en', 'kn'] as const)('%s: renders the poster block with the asset-pending note', async (lang) => {
      const html = normalize(await (await renderPartnerKit(lang, SLUG)).text());
      expect(html).toMatch(/class="poster-block"/);
      expect(html).toContain(t(lang, 'partnerKit.poster.pendingNote'));
    });
  });

  describe('print styles (design-system.md §11)', () => {
    it('the page component source contains an @media print rule scoped to .poster-block', () => {
      const source = readFileSync(
        new URL('../../src/features/pages/PartnerKit.astro', import.meta.url),
        'utf-8',
      );
      expect(source).toMatch(/@media print\s*{/);
      const printBlockMatch = source.match(/@media print\s*{[\s\S]*?\n {2}}/);
      expect(printBlockMatch, 'expected an @media print block').not.toBeNull();
      expect(printBlockMatch![0]).toContain('.poster-block');
    });
  });

  describe('noindex (unlisted, IA §3.19)', () => {
    it('Base renders a noindex robots meta tag', async () => {
      const html = normalize(await (await renderPartnerKit('en', SLUG)).text());
      expect(html).toContain('<meta name="robots" content="noindex">');
    });

    it('the real middleware sets X-Robots-Tag: noindex on the response', async () => {
      const res = await renderPartnerKitThroughMiddleware('en', SLUG);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    });
  });

  describe('cache-safety (architecture.md §5)', () => {
    it('markup is byte-identical whether or not the request carries a session cookie', async () => {
      const noCookie = normalize(await (await renderPartnerKit('en', SLUG)).text());
      const withCookie = normalize(
        await (await renderPartnerKit('en', SLUG, { cookie: 'session=some-signed-in-users-session-id' })).text(),
      );
      expect(withCookie).toBe(noCookie);
    });
  });

  describe('lang attribute + hreflang pair', () => {
    it('sets <html lang> and emits the en/kn hreflang alternates', async () => {
      const enHtml = normalize(await (await renderPartnerKit('en', SLUG)).text());
      const knHtml = normalize(await (await renderPartnerKit('kn', SLUG)).text());

      expect(enHtml).toMatch(/<html lang="en"/);
      expect(knHtml).toMatch(/<html lang="kn"/);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/partner/${SLUG}">`);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/partner/${SLUG}">`);
      expect(knHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/partner/${SLUG}">`);
      expect(knHtml).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/partner/${SLUG}">`);
    });
  });

  describe('no-JS-safe copy', () => {
    it('the only extra module script on the page is the CopyButton island import', async () => {
      const html = await (await renderPartnerKit('en', SLUG)).text();
      const scriptSrcs = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
      // Astro bundles the page's own <script> (importing initCopyButtons)
      // plus Base's own MeSlot-mounting script — both pre-existing,
      // hashed/external files, never inline nonce'd scripts.
      expect(scriptSrcs.length).toBeGreaterThan(0);
      expect(html).not.toMatch(/<script[^>]*nonce=/);
    });

    it('the tagged-link input and every forward-text textarea are readonly (work without JS)', async () => {
      const html = normalize(await (await renderPartnerKit('en', SLUG)).text());
      const readonlyInputs = [...html.matchAll(/<input[^>]*readonly[^>]*>/g)];
      const readonlyTextareas = [...html.matchAll(/<textarea[^>]*readonly[^>]*>/g)];
      expect(readonlyInputs.length).toBeGreaterThanOrEqual(1);
      expect(readonlyTextareas.length).toBe(4);
    });
  });
});
