import { describe, it, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { localePath, t, type Lang } from '../../src/i18n';
import About from '../../src/features/pages/About.astro';
import Terms from '../../src/features/pages/Terms.astro';
import Privacy from '../../src/features/pages/Privacy.astro';

// The rendered courtesy-translation BANNER text (legal.courtesyNote), not a
// loose substring like "courtesy translation" — the /privacy content itself
// discusses the courtesy-translation concept in its own "Language of this
// policy" prose (both EN and KN), so a loose substring check would give a
// false positive/negative unrelated to whether the Banner actually rendered.
const EN_COURTESY_NOTE = t('en', 'legal.courtesyNote');
const KN_COURTESY_NOTE = t('kn', 'legal.courtesyNote');

/**
 * Task 22 — the trust & legal pages (/about, /terms, /privacy), IA
 * §3.13/§3.17/§3.18, PRD §5.11/§5.16. Container-rendered, both languages,
 * mirroring tests/routes/guides.test.ts's structure.
 *
 * None of these three pages read app_settings, cookies, or the DB — they
 * render purely from repo editorial content (src/i18n/content.ts) — so,
 * unlike guides.test.ts, no migration/DB fixture setup is needed here.
 */

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

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

async function renderPage(
  Component: any,
  lang: Lang,
  path: string,
  headers?: Record<string, string>,
): Promise<{ html: string; response: Response }> {
  const container = await makeContainer();
  const response = await container.renderToResponse(Component, {
    partial: false,
    props: { lang },
    request: new Request(`${SITE_ORIGIN}${localePath(lang, path)}`, { headers }),
  });
  const html = normalize(await response.text());
  return { html, response };
}

describe('Trust & legal pages (Task 22) — IA §3.13/§3.17/§3.18, PRD §5.11/§5.16', () => {
  describe('About (/about)', () => {
    it('renders a distinctive sentence from the EN content, in both languages, with correct title/description/lang', async () => {
      const en = await renderPage(About, 'en', '/about');
      expect(en.html).toContain('Oorvani Foundation');
      expect(en.html).toContain('<title>About this platform');
      expect(en.html).toMatch(/<html lang="en"/);

      const kn = await renderPage(About, 'kn', '/about');
      expect(kn.html).toContain('ಊರ್ವಾಣಿ ಫೌಂಡೇಶನ್');
      expect(kn.html).toMatch(/<html lang="kn"/);
    });

    it('emits hreflang alternates for both languages', async () => {
      const { html } = await renderPage(About, 'en', '/about');
      expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/about">`);
      expect(html).toContain(`hreflang="en" href="${SITE_ORIGIN}/about"`);
      expect(html).toContain(`hreflang="kn" href="${SITE_ORIGIN}/kn/about"`);
    });

    it('never leaks INPUT NEEDED authoring markers into the rendered HTML', async () => {
      const { html } = await renderPage(About, 'en', '/about');
      expect(html).not.toContain('INPUT NEEDED');
    });

    it('emits the platform Organization JSON-LD (src/lib/seo.ts#orgLd), Oorvani Foundation as parent/publisher, `<` escaped', async () => {
      const { html } = await renderPage(About, 'en', '/about');
      const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      expect(match, 'expected an application/ld+json script tag').not.toBeNull();
      const payload = match![1];

      expect(payload).toContain('"@type":"Organization"');
      expect(payload).toContain('Bengaluru Votes');
      expect(payload).toContain('Oorvani Foundation');
      expect(payload).toContain(SITE_ORIGIN);

      // The serialized payload itself carries no raw, unescaped '<' that
      // could break out of the script tag (architecture.md §13).
      expect(payload).not.toContain('<');

      const parsed = JSON.parse(payload);
      expect(parsed['@type']).toBe('Organization');
      expect(parsed.name).toBe('Bengaluru Votes');
      expect(parsed.url).toBe(SITE_ORIGIN);
      expect(parsed.parentOrganization.name).toBe('Oorvani Foundation');
      expect(parsed.publisher.name).toBe('Oorvani Foundation');
    });

    it('does NOT show the courtesy-translation note, in either language', async () => {
      const en = await renderPage(About, 'en', '/about');
      expect(en.html).not.toContain(EN_COURTESY_NOTE);
      const kn = await renderPage(About, 'kn', '/about');
      expect(kn.html).not.toContain(KN_COURTESY_NOTE);
    });

    it('cache-safety: no set-cookie header, identical markup with/without a cookie on the request', async () => {
      const plain = await renderPage(About, 'en', '/about');
      expect(plain.response.headers.get('set-cookie')).toBeNull();

      const withCookie = await renderPage(About, 'en', '/about', { cookie: 'session=abc123' });
      expect(withCookie.response.headers.get('set-cookie')).toBeNull();
      expect(withCookie.html).toBe(plain.html);
    });
  });

  describe('Terms (/terms)', () => {
    it('renders a distinctive sentence from the EN content, in both languages, with correct title/description/lang', async () => {
      const en = await renderPage(Terms, 'en', '/terms');
      expect(en.html).toContain('Acceptable use');
      expect(en.html).toContain('<title>Terms and conditions');
      expect(en.html).toMatch(/<html lang="en"/);

      const kn = await renderPage(Terms, 'kn', '/terms');
      expect(kn.html).toContain('ಊರ್ವಾಣಿ ಫೌಂಡೇಶನ್');
      expect(kn.html).toMatch(/<html lang="kn"/);
    });

    it('never leaks LEGAL REVIEW REQUIRED / INPUT NEEDED authoring markers into the rendered HTML', async () => {
      const { html } = await renderPage(Terms, 'en', '/terms');
      expect(html).not.toContain('LEGAL REVIEW REQUIRED');
      expect(html).not.toContain('INPUT NEEDED');
    });

    it('shows the courtesy-translation note on the KN page only, not on EN', async () => {
      const kn = await renderPage(Terms, 'kn', '/terms');
      expect(kn.html).toContain(KN_COURTESY_NOTE);
      expect(kn.html).toContain('banner--notice');

      const en = await renderPage(Terms, 'en', '/terms');
      expect(en.html).not.toContain(EN_COURTESY_NOTE);
      expect(en.html).not.toContain(KN_COURTESY_NOTE);
      expect(en.html).not.toContain('banner--notice');
    });

    it('cache-safety: no set-cookie header, identical markup with/without a cookie on the request', async () => {
      const plain = await renderPage(Terms, 'en', '/terms');
      expect(plain.response.headers.get('set-cookie')).toBeNull();

      const withCookie = await renderPage(Terms, 'en', '/terms', { cookie: 'session=abc123' });
      expect(withCookie.response.headers.get('set-cookie')).toBeNull();
      expect(withCookie.html).toBe(plain.html);
    });
  });

  describe('Privacy (/privacy)', () => {
    it('renders a distinctive sentence from the EN content, in both languages, with correct title/description/lang', async () => {
      const en = await renderPage(Privacy, 'en', '/privacy');
      expect(en.html).toContain('Oorvani Foundation');
      expect(en.html).toContain('<title>Privacy policy');
      expect(en.html).toMatch(/<html lang="en"/);

      const kn = await renderPage(Privacy, 'kn', '/privacy');
      expect(kn.html).toContain('ಊರ್ವಾಣಿ ಫೌಂಡೇಶನ್');
      expect(kn.html).toMatch(/<html lang="kn"/);
    });

    it('never leaks LEGAL REVIEW REQUIRED / INPUT NEEDED authoring markers into the rendered HTML', async () => {
      const { html } = await renderPage(Privacy, 'en', '/privacy');
      expect(html).not.toContain('LEGAL REVIEW REQUIRED');
      expect(html).not.toContain('INPUT NEEDED');
    });

    it('carries the full §5.16 processor inventory', async () => {
      const { html } = await renderPage(Privacy, 'en', '/privacy');
      for (const processor of ['SendGrid', 'Twilio', 'Google', 'Anthropic', 'Sentry']) {
        expect(html).toContain(processor);
      }
      expect(html).toContain('reCAPTCHA');
    });

    it('shows the courtesy-translation note on the KN page only, not on EN', async () => {
      const kn = await renderPage(Privacy, 'kn', '/privacy');
      expect(kn.html).toContain(KN_COURTESY_NOTE);
      expect(kn.html).toContain('banner--notice');

      const en = await renderPage(Privacy, 'en', '/privacy');
      expect(en.html).not.toContain(EN_COURTESY_NOTE);
      // The EN /privacy content's OWN "Language of this policy" prose does
      // legitimately mention that the Kannada version is a courtesy
      // translation — that's fine; only the rendered Banner element (never
      // shown on EN) is what this test guards against.
      expect(en.html).not.toContain('banner--notice');
    });

    it('cache-safety: no set-cookie header, identical markup with/without a cookie on the request', async () => {
      const plain = await renderPage(Privacy, 'en', '/privacy');
      expect(plain.response.headers.get('set-cookie')).toBeNull();

      const withCookie = await renderPage(Privacy, 'en', '/privacy', { cookie: 'session=abc123' });
      expect(withCookie.response.headers.get('set-cookie')).toBeNull();
      expect(withCookie.html).toBe(plain.html);
    });
  });
});
