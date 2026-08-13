/**
 * /press, /kn/press (Task 51) — IA §3.16, PRD §5.15.
 *
 * COVERAGE MAP:
 *   - Renders the Task 8 content: boilerplate (both authored lengths),
 *     the neutrality statement, and the sourcing-methodology link to
 *     `/about`.
 *   - Renders CURRENT KEY STATS drawn from `publicMetrics()` — at least
 *     one figure (e.g. registered citizens / flags resolved / wards with
 *     data) is present.
 *   - `<!-- INPUT NEEDED -->` authoring markers never leak into the
 *     rendered HTML (renderContentHtml strips them).
 *   - Contact section renders with a "coming soon" placeholder that
 *     mentions the still-pending response time — never a fabricated
 *     email/phone.
 *   - SHIPS REGARDLESS of `data_page_live` (Phase 1 asset, unlike
 *     `/data`'s Phase-2 gate) — renders identically whether that setting
 *     is 'true', 'false', or unset.
 *   - Cache-safe; lang + hreflang.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { localePath, t, type Lang } from '../../src/i18n';

vi.mock('../../src/lib/settings', () => ({ getKnownSetting: vi.fn() }));

import { getKnownSetting } from '../../src/lib/settings';
import Press from '../../src/features/pages/Press.astro';
// Reuses the SHARED module-level pool (src/db/client.ts) rather than opening
// a dedicated connection — same rationale as tests/routes/data.test.ts: this
// file only needs a `db` handle for the idempotent `migrate()` call and
// never inserts/deletes fixture rows directly. Never `.end()` this shared
// client — other test files still need it.
import { db } from '../../src/db/client';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

function normalize(html: string): string {
  return html
    .replace(/\s+data-astro-cid-\w+/g, '')
    .replace(/\s+data-astro-(?:source-file|source-loc)="[^"]*"/g, '')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+/g, ' ');
}

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

async function renderPage(lang: Lang, headers?: Record<string, string>): Promise<{ html: string; response: Response }> {
  const container = await makeContainer();
  const response = await container.renderToResponse(Press, {
    partial: false,
    props: { lang },
    request: new Request(`${SITE_ORIGIN}${localePath(lang, '/press')}`, { headers }),
  });
  const html = normalize(await response.text());
  return { html, response };
}

describe('Press kit (/press, /kn/press) — IA §3.16, PRD §5.15', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  beforeEach(() => {
    vi.mocked(getKnownSetting).mockReset().mockResolvedValue(null);
  });

  describe('content', () => {
    it('renders the boilerplate (50 and 100 word lengths) and the neutrality statement', async () => {
      const { html } = await renderPage('en');
      expect(html).toContain('50 words');
      expect(html).toContain('100 words');
      expect(html).toContain('does not endorse or oppose any candidate');
    });

    it('links to sourcing methodology on /about', async () => {
      const { html } = await renderPage('en');
      expect(html).toContain('href="/about"');
    });

    it('never leaks INPUT NEEDED authoring markers into the rendered HTML', async () => {
      const { html } = await renderPage('en');
      expect(html).not.toContain('INPUT NEEDED');
    });
  });

  describe('current key stats (drawn from publicMetrics)', () => {
    it('renders a "current key stats" block carrying at least one live metrics figure', async () => {
      const { html } = await renderPage('en');
      expect(html).toContain(t('en', 'press.keyStats.registeredCitizens.label'));
      expect(html).toContain(t('en', 'press.keyStats.wardsWithData.label'));
      expect(html).toContain(t('en', 'press.keyStats.flagsResolved.label'));
      // A real numeric figure rendered inside a stat value.
      expect(html).toMatch(/<dd class="stat-value">\d+/);
    });

    it('carries its own "as of" timestamp note', async () => {
      const { html } = await renderPage('en');
      expect(html).toContain('as-of');
    });
  });

  describe('logos, spokesperson, contact — honest placeholders, never fabricated', () => {
    it('renders logo/screenshot download placeholders (no invented asset URLs)', async () => {
      const { html } = await renderPage('en');
      expect(html).toContain(t('en', 'press.logos.pendingNote'));
    });

    it('renders a spokesperson placeholder (no invented name/bio)', async () => {
      const { html } = await renderPage('en');
      expect(html).toContain(t('en', 'press.spokesperson.pendingNote'));
    });

    it('renders a contact + response-time placeholder (no invented email/phone)', async () => {
      const { html } = await renderPage('en');
      expect(html).toContain(t('en', 'press.contact.pendingNote'));
      expect(html.toLowerCase()).not.toMatch(/@\w+\.\w+/); // no fabricated email address
    });
  });

  describe('ships regardless of data_page_live (Phase 1 asset — PRD §5.15)', () => {
    it.each(['true', 'false', null] as const)('renders identically-structured content when data_page_live is %j', async (value) => {
      vi.mocked(getKnownSetting).mockResolvedValue(value);
      const { html, response } = await renderPage('en');
      expect(response.status).toBe(200);
      expect(html).toContain(t('en', 'press.keyStats.registeredCitizens.label'));
      expect(html).toContain('does not endorse or oppose any candidate');
    });
  });

  describe('cache-safety (architecture.md §5)', () => {
    it('markup is byte-identical whether or not the request carries a session cookie', async () => {
      const noCookie = await renderPage('en');
      const withCookie = await renderPage('en', { cookie: 'session=some-signed-in-users-session-id' });
      expect(withCookie.html).toBe(noCookie.html);
    });
  });

  describe('lang attribute + hreflang pair', () => {
    it('sets <html lang> and emits the en/kn hreflang alternates', async () => {
      const en = await renderPage('en');
      const kn = await renderPage('kn');

      expect(en.html).toMatch(/<html lang="en"/);
      expect(kn.html).toMatch(/<html lang="kn"/);
      expect(en.html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/press">`);
      expect(en.html).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/press">`);
      expect(kn.html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/kn/press">`);
      expect(kn.html).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/press">`);
    });

    it('renders the Kannada key-stats labels in Kannada', async () => {
      const kn = await renderPage('kn');
      expect(kn.html).toContain(t('kn', 'press.keyStats.registeredCitizens.label'));
    });
  });
});
