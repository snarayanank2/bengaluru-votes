/**
 * /data, /kn/data (Task 51) — IA §3.14, PRD §5.14, architecture.md §5.
 *
 * COVERAGE MAP:
 *   - PHASE GATE: `app_settings.data_page_live` !== 'true' -> the held
 *     "coming at the notification" notice at HTTP 200, and NONE of the
 *     real coverage/integrity/citizen-signal figures render.
 *   - `data_page_live === 'true'` -> the full metrics render: coverage
 *     (wardsWithData/total, wardsSignedOff, reportCardsComplete,
 *     activeCurators, sourcesCited), integrity, citizen signal
 *     (IssueBars city-wide roll-up or its empty note), and an "as of"
 *     timestamp — figures, not datasets (no download/API link).
 *   - Cache-safe (byte-identical with/without a session cookie).
 *   - lang attribute + hreflang pair.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { localePath, t, type Lang } from '../../src/i18n';

vi.mock('../../src/lib/settings', () => ({ getKnownSetting: vi.fn() }));

import { getKnownSetting } from '../../src/lib/settings';
import Data from '../../src/features/pages/Data.astro';
// Reuses the SHARED module-level pool (src/db/client.ts) rather than opening
// a dedicated connection of its own — this file only needs a `db` handle to
// run `migrate()` (idempotent) and never inserts/deletes fixture rows
// directly (unlike tests/unit/metrics.test.ts), so a second connection would
// be pure overhead against the test Postgres instance's connection ceiling.
// Never call `.end()` on this shared client — other test files still need it.
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

async function renderPage(
  lang: Lang,
  headers?: Record<string, string>,
): Promise<{ html: string; response: Response }> {
  const container = await makeContainer();
  const response = await container.renderToResponse(Data, {
    partial: false,
    props: { lang },
    request: new Request(`${SITE_ORIGIN}${localePath(lang, '/data')}`, { headers }),
  });
  const html = normalize(await response.text());
  return { html, response };
}

describe('Data & key metrics (/data, /kn/data) — IA §3.14, PRD §5.14', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  beforeEach(() => {
    vi.mocked(getKnownSetting).mockReset();
  });

  describe('PHASE GATE — data_page_live is not "true"', () => {
    it.each([null, 'false', ''] as const)('setting value %j -> the held notice renders, HTTP 200, no figures', async (value) => {
      vi.mocked(getKnownSetting).mockResolvedValue(value);
      const { html, response } = await renderPage('en');

      expect(response.status).toBe(200);
      expect(html).toContain(t('en', 'data.notLive.body'));

      // NONE of the real figures/sections render in the held state (checked
      // by structural id, not translated heading text — "Coverage" is also
      // a substring of this page's <meta description>, which always
      // renders regardless of the phase gate).
      expect(html).not.toContain('id="coverage-heading"');
      expect(html).not.toContain('id="integrity-heading"');
      expect(html).not.toContain('id="citizen-signal-heading"');
      expect(html).not.toContain('stat-grid');
      expect(html).not.toContain(t('en', 'data.figuresNotDatasets'));
    });

    it('renders the held notice in Kannada too', async () => {
      vi.mocked(getKnownSetting).mockResolvedValue(null);
      const { html } = await renderPage('kn');
      expect(html).toContain(t('kn', 'data.notLive.body'));
      expect(html).not.toContain('id="coverage-heading"');
    });
  });

  describe('data_page_live === "true" — the real figures render', () => {
    it('renders coverage, integrity, citizen-signal sections, an as-of timestamp, and the figures-not-datasets note', async () => {
      vi.mocked(getKnownSetting).mockResolvedValue('true');
      const { html, response } = await renderPage('en');

      expect(response.status).toBe(200);
      expect(html).not.toContain(t('en', 'data.notLive.body'));

      expect(html).toContain(t('en', 'data.coverage.heading'));
      expect(html).toContain(t('en', 'data.coverage.wardsWithData.label'));
      expect(html).toContain(t('en', 'data.coverage.wardsSignedOff.label'));
      expect(html).toContain(t('en', 'data.coverage.reportCardsComplete.label'));
      expect(html).toContain(t('en', 'data.coverage.activeCurators.label'));
      expect(html).toContain(t('en', 'data.coverage.sourcesCited.label'));

      expect(html).toContain(t('en', 'data.integrity.heading'));
      expect(html).toContain(t('en', 'data.integrity.flagsRaised.label'));
      expect(html).toContain(t('en', 'data.integrity.flagsResolved.label'));

      expect(html).toContain(t('en', 'data.citizenSignal.heading'));
      expect(html).toContain(t('en', 'data.citizenSignal.issueRollup.heading'));
      // Either the roll-up renders (data-issue-bars) or its honest empty note does.
      expect(html.includes('data-issue-bars') || html.includes(t('en', 'data.citizenSignal.issueRollup.empty'))).toBe(true);

      // "as of" — the timestamp paragraph rendered.
      expect(html).toContain('as-of');

      // Figures, not datasets — the note is present, and there is no actual
      // download link or dataset API endpoint anywhere on the page.
      // (HTML-escapes the apostrophe in "that's", so match on the
      // unambiguous, apostrophe-free prefix rather than the full string.)
      expect(html).toContain('published figures, not a downloadable dataset or API');
      expect(html).not.toMatch(/href="[^"]*\.csv"|\/api\/data\b/i);
    });

    it('renders in Kannada too, with the coverage/integrity/citizen-signal headings translated', async () => {
      vi.mocked(getKnownSetting).mockResolvedValue('true');
      const { html } = await renderPage('kn');

      expect(html).toContain(t('kn', 'data.coverage.heading'));
      expect(html).toContain(t('kn', 'data.integrity.heading'));
      expect(html).toContain(t('kn', 'data.citizenSignal.heading'));
    });
  });

  describe('cache-safety (architecture.md §5)', () => {
    it('markup is byte-identical whether or not the request carries a session cookie', async () => {
      vi.mocked(getKnownSetting).mockResolvedValue('true');
      const noCookie = await renderPage('en');
      vi.mocked(getKnownSetting).mockResolvedValue('true');
      const withCookie = await renderPage('en', { cookie: 'session=some-signed-in-users-session-id' });
      expect(withCookie.html).toBe(noCookie.html);
    });
  });

  describe('lang attribute + hreflang pair', () => {
    it('sets <html lang> and emits the en/kn hreflang alternates', async () => {
      vi.mocked(getKnownSetting).mockResolvedValue('true');
      const en = await renderPage('en');
      vi.mocked(getKnownSetting).mockResolvedValue('true');
      const kn = await renderPage('kn');

      expect(en.html).toMatch(/<html lang="en"/);
      expect(kn.html).toMatch(/<html lang="kn"/);
      expect(en.html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/data">`);
      expect(en.html).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/data">`);
      expect(kn.html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/kn/data">`);
      expect(kn.html).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/data">`);
    });
  });
});
