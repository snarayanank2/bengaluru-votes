import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import { localePath, type Lang } from '../../src/i18n';

vi.mock('../../src/lib/settings', () => ({ getSettings: vi.fn() }));
vi.mock('../../src/lib/geocode', () => ({ lookupWardByAddress: vi.fn() }));
vi.mock('../../src/lib/pincode', () => ({ wardsForPincode: vi.fn() }));

import { getSettings } from '../../src/lib/settings';
import { lookupWardByAddress } from '../../src/lib/geocode';
import { wardsForPincode } from '../../src/lib/pincode';
import Home from '../../src/features/pages/Home.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. CI always sets this; for local runs export ' +
      'DATABASE_URL=postgres://postgres@localhost:54329/bv_test (see task brief).',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific id so this suite never collides with another test
// file's ward fixtures in the shared (not reset-between-files) test DB.
const WARD = {
  id: 96001,
  nameEn: 'Home Test Ward',
  nameKn: 'ಹೋಮ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'home-test-ward',
};

/**
 * Strips the container API's dev-mode debug attributes and collapses
 * incidental whitespace (see tests/routes/layout.test.ts for the same
 * helper/rationale).
 */
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

async function renderHome(lang: Lang): Promise<string> {
  const container = await makeContainer();
  const html = await container.renderToString(Home, {
    partial: false,
    props: { lang },
    request: new Request(`${SITE_ORIGIN}${localePath(lang, '/')}`),
  });
  return normalize(html);
}

const NO_SETTINGS = { notification_date: null, election_date: null, roll_deadline: null };

describe('Home page (/, /kn/) — IA §3.1, PRD §5.1/§5.7', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(() => {
    vi.mocked(getSettings).mockReset().mockResolvedValue(NO_SETTINGS);
    vi.mocked(lookupWardByAddress).mockReset();
    vi.mocked(wardsForPincode).mockReset();
  });

  describe('page structure', () => {
    it('renders a real POST form with the address input, in both languages', async () => {
      for (const lang of ['en', 'kn'] as const) {
        const html = await renderHome(lang);
        expect(html).toMatch(/<!doctype html>/i);
        expect(html).toContain(`<form method="post" action="${localePath(lang, '/')}"`);
        expect(html).toContain('name="query"');
      }
    });

    it('sets <html lang> correctly and emits the hreflang pair (via Base)', async () => {
      const enHtml = await renderHome('en');
      const knHtml = await renderHome('kn');
      expect(enHtml).toMatch(/<html lang="en"/);
      expect(knHtml).toMatch(/<html lang="kn"/);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/">`);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/">`);
      expect(knHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/">`);
      expect(knHtml).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/">`);
    });

    it('emits its own WardLookup island script, plus Base.astro\'s global Register/Login, Flag, Vote modal, MeSlot, and ?src attribution scripts (Tasks 27/28/32/33/49) — no others', async () => {
      const html = await renderHome('en');
      const scriptOpenTags = html.match(/<script\b[^>]*>/g) ?? [];
      // Every module script must be one of these five globally-expected
      // sources: this page's own WardLookup island, the Register/Login
      // modal Base.astro renders on every page (src/components/
      // RegisterLoginModal.astro), the Flag misinformation modal (Task 32,
      // src/components/FlagModal.astro), the Cast issue vote modal (Task 33,
      // src/components/VoteModal.astro), or Base.astro's own MeSlot mount
      // (Task 28, src/islands/MeSlot.ts) — PLUS Base.astro's inline `?src`
      // attribution writer (Task 49, src/lib/attribution.ts), which is
      // deliberately NOT `type="module"` (it's one of the two CSP-allowed
      // inline scripts, architecture §13) — never a stray/unexpected
      // seventh script.
      expect(scriptOpenTags).toHaveLength(6);
      const moduleScripts = scriptOpenTags.filter((tag) => tag.includes('type="module"'));
      const inlineScripts = scriptOpenTags.filter((tag) => !tag.includes('type="module"'));
      expect(moduleScripts).toHaveLength(5);
      expect(inlineScripts).toHaveLength(1);
      expect(html).toMatch(/Home\.astro\?astro&type=script/);
      expect(html).toMatch(/RegisterLoginModal\.astro\?astro&type=script/);
      expect(html).toMatch(/FlagModal\.astro\?astro&type=script/);
      expect(html).toMatch(/VoteModal\.astro\?astro&type=script/);
      expect(html).toMatch(/Base\.astro\?astro&type=script/);
      expect(html).toMatch(/bv_src/);
    });
  });

  describe('election status (app_settings, mocked via src/lib/settings)', () => {
    it('shows "notification awaited" when notification_date is absent', async () => {
      vi.mocked(getSettings).mockResolvedValue(NO_SETTINGS);
      const html = await renderHome('en');
      expect(html).toContain('Election notification awaited');
    });

    it('shows the election status once notification_date and election_date are set', async () => {
      vi.mocked(getSettings).mockResolvedValue({
        notification_date: '2026-08-01',
        election_date: '2026-09-15',
        roll_deadline: null,
      });
      const html = await renderHome('en');
      expect(html).not.toContain('Election notification awaited');
      expect(html).toContain('2026-08-01');
      expect(html).toContain('2026-09-15');
    });
  });

  describe('roll deadline (DeadlineBanner)', () => {
    it('renders DeadlineBanner when roll_deadline is set in the future', async () => {
      vi.mocked(getSettings).mockResolvedValue({
        notification_date: null,
        election_date: null,
        roll_deadline: '2099-12-31',
      });
      const html = await renderHome('en');
      expect(html).toContain('deadline-banner');
    });

    it('renders nothing there when roll_deadline is absent', async () => {
      vi.mocked(getSettings).mockResolvedValue(NO_SETTINGS);
      const html = await renderHome('en');
      expect(html).not.toContain('deadline-banner');
    });

    it('does not render DeadlineBanner when roll_deadline is in the past', async () => {
      vi.mocked(getSettings).mockResolvedValue({
        notification_date: null,
        election_date: null,
        roll_deadline: '2000-01-01',
      });
      const html = await renderHome('en');
      expect(html).not.toContain('deadline-banner');
    });
  });

  describe('shortcut cards', () => {
    it('links to /check-registration and /voting-guide, locale-correct', async () => {
      const enHtml = await renderHome('en');
      const knHtml = await renderHome('kn');
      expect(enHtml).toContain('href="/check-registration"');
      expect(enHtml).toContain('href="/voting-guide"');
      expect(knHtml).toContain('href="/kn/check-registration"');
      expect(knHtml).toContain('href="/kn/voting-guide"');
    });
  });

  describe('no-JS POST fallback', () => {
    it('resolves an address to a ward and server-renders a link to /ward/{id}, no-store', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'ward', wardId: WARD.id });

      const container = await makeContainer();
      const request = new Request(`${SITE_ORIGIN}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `query=${encodeURIComponent('1 MG Road')}`,
      });
      const response = await container.renderToResponse(Home, {
        partial: false,
        props: { lang: 'en' },
        request,
      });
      const html = normalize(await response.text());

      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(html).toContain(`href="/ward/${WARD.id}"`);
      expect(html).toContain(WARD.nameEn);
    });

    it('renders the explicit out-of-coverage message', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'out_of_coverage' });

      const container = await makeContainer();
      const request = new Request(`${SITE_ORIGIN}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `query=${encodeURIComponent('Nowhere at all')}`,
      });
      const response = await container.renderToResponse(Home, {
        partial: false,
        props: { lang: 'en' },
        request,
      });
      const html = normalize(await response.text());

      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(html).toContain("doesn't appear to be in the GBA area");
    });

    it('a pincode shortlist server-renders every candidate ward link', async () => {
      vi.mocked(wardsForPincode).mockReturnValueOnce([WARD.id]);

      const container = await makeContainer();
      const request = new Request(`${SITE_ORIGIN}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'query=560001',
      });
      const response = await container.renderToResponse(Home, {
        partial: false,
        props: { lang: 'en' },
        request,
      });
      const html = normalize(await response.text());

      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(html).toContain(`href="/ward/${WARD.id}"`);
      expect(lookupWardByAddress).not.toHaveBeenCalled();
    });

    it('GET is unaffected — no cache-control: no-store on a plain GET render', async () => {
      const container = await makeContainer();
      const response = await container.renderToResponse(Home, {
        partial: false,
        props: { lang: 'en' },
        request: new Request(`${SITE_ORIGIN}/`),
      });
      expect(response.headers.get('cache-control')).not.toBe('no-store');
    });
  });
});
