/**
 * /partner-with-us, /kn/partner-with-us (Task 50) — IA §3.15, PRD §5.13,
 * architecture.md §7/§13. Container-rendered, both languages, same
 * no-DB-needed technique as tests/routes/legal.test.ts (this page reads only
 * repo content + `process.env.RECAPTCHA_SITE_KEY`, no DB/cookie/session).
 *
 * COVERAGE MAP:
 *   - renders both paths (spread awareness / curate data) from the Task 8
 *     content, plus the EOI form (path selector, name, contact fields).
 *   - the reCAPTCHA script tag is present ONLY when RECAPTCHA_SITE_KEY is
 *     configured, and ONLY on this page — Home/About never emit it.
 *   - cache-safe (byte-identical with/without a session cookie).
 *   - lang attribute + hreflang pair.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { localePath, t, type Lang } from '../../src/i18n';
import PartnerWithUs from '../../src/features/pages/PartnerWithUs.astro';
import Home from '../../src/features/pages/Home.astro';
import About from '../../src/features/pages/About.astro';

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const RECAPTCHA_SCRIPT_RE = /<script[^>]*src="https:\/\/www\.google\.com\/recaptcha\/api\.js\?render=[^"]*"[^>]*>/;

const ORIGINAL_SITE_KEY = process.env.RECAPTCHA_SITE_KEY;

afterEach(() => {
  if (ORIGINAL_SITE_KEY === undefined) {
    delete process.env.RECAPTCHA_SITE_KEY;
  } else {
    process.env.RECAPTCHA_SITE_KEY = ORIGINAL_SITE_KEY;
  }
});

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

describe('Partner with us (/partner-with-us, /kn/partner-with-us) — IA §3.15, PRD §5.13', () => {
  describe('content: both paths + expectations render', () => {
    it.each(['en', 'kn'] as const)('%s: renders spread-awareness and curate-data sections', async (lang) => {
      const { html } = await renderPage(PartnerWithUs, lang, '/partner-with-us');
      expect(html).toContain(lang === 'en' ? 'Spread awareness' : 'ಜಾಗೃತಿ');
      expect(html).toContain(lang === 'en' ? 'Curate data' : 'ದತ್ತಾಂಶ');
    });

    it('never leaks INPUT NEEDED authoring markers into the rendered HTML', async () => {
      const { html } = await renderPage(PartnerWithUs, 'en', '/partner-with-us');
      expect(html).not.toContain('INPUT NEEDED');
    });
  });

  describe('the EOI form', () => {
    it('renders a path selector (awareness/curation), and name/contact fields', async () => {
      const { html } = await renderPage(PartnerWithUs, 'en', '/partner-with-us');

      expect(html).toMatch(/<form[^>]*data-eoi-form/);
      expect(html).toContain('<option value="awareness">');
      expect(html).toContain('<option value="curation">');
      expect(html).toMatch(/name="name"/);
      expect(html).toMatch(/name="contact"/);
      expect(html).toMatch(/name="organisation"/);
      expect(html).toMatch(/name="wardsText"/);
      expect(html).toMatch(/name="message"/);
    });

    it('is a single form covering BOTH paths, not two separate forms', async () => {
      // Base.astro also renders the (unrelated) Register/Login, Flag, and
      // Vote modal <form>s on every page — so this asserts there is exactly
      // ONE `[data-eoi-form]`, not that the whole page has only one <form>.
      const { html } = await renderPage(PartnerWithUs, 'en', '/partner-with-us');
      const eoiFormCount = (html.match(/data-eoi-form/g) ?? []).length;
      expect(eoiFormCount).toBe(1);
    });

    it('carries the submit button and the four message slots the client island reads', async () => {
      const { html } = await renderPage(PartnerWithUs, 'en', '/partner-with-us');
      expect(html).toMatch(/data-eoi-submit/);
      expect(html).toMatch(/data-eoi-success/);
      expect(html).toMatch(/data-eoi-error/);
      expect(html).toMatch(/data-msg-generic-error/);
      expect(html).toMatch(/data-msg-recaptcha-failed/);
      expect(html).toMatch(/data-msg-invalid/);
      expect(html).toMatch(/data-msg-success/);
    });
  });

  describe('reCAPTCHA script loads ONLY on this page, ONLY when a site key is configured', () => {
    it('RECAPTCHA_SITE_KEY configured -> the api.js?render= script tag is present, carrying the key', async () => {
      process.env.RECAPTCHA_SITE_KEY = 'test-site-key-123';
      const { html } = await renderPage(PartnerWithUs, 'en', '/partner-with-us');
      expect(html).toMatch(RECAPTCHA_SCRIPT_RE);
      expect(html).toContain('render=test-site-key-123');
      expect(html).toMatch(/data-recaptcha-site-key="test-site-key-123"/);
    });

    it('RECAPTCHA_SITE_KEY absent (this repo\'s dev/test env) -> no reCAPTCHA script tag, form still renders', async () => {
      delete process.env.RECAPTCHA_SITE_KEY;
      const { html } = await renderPage(PartnerWithUs, 'en', '/partner-with-us');
      expect(html).not.toMatch(RECAPTCHA_SCRIPT_RE);
      expect(html).not.toContain('google.com/recaptcha');
      expect(html).toMatch(/<form[^>]*data-eoi-form/);
    });

    it('Home does NOT emit a reCAPTCHA script even when a site key is configured', async () => {
      process.env.RECAPTCHA_SITE_KEY = 'test-site-key-123';
      const { html } = await renderPage(Home, 'en', '/');
      expect(html).not.toContain('google.com/recaptcha');
    });

    it('About does NOT emit a reCAPTCHA script even when a site key is configured', async () => {
      process.env.RECAPTCHA_SITE_KEY = 'test-site-key-123';
      const { html } = await renderPage(About, 'en', '/about');
      expect(html).not.toContain('google.com/recaptcha');
    });
  });

  describe('cache-safety (architecture.md §5)', () => {
    it('markup is byte-identical whether or not the request carries a session cookie', async () => {
      delete process.env.RECAPTCHA_SITE_KEY;
      const noCookie = await renderPage(PartnerWithUs, 'en', '/partner-with-us');
      const withCookie = await renderPage(PartnerWithUs, 'en', '/partner-with-us', {
        cookie: 'session=some-signed-in-users-session-id',
      });
      expect(withCookie.html).toBe(noCookie.html);
    });
  });

  describe('lang attribute + hreflang pair', () => {
    it('sets <html lang> and emits the en/kn hreflang alternates', async () => {
      const en = await renderPage(PartnerWithUs, 'en', '/partner-with-us');
      const kn = await renderPage(PartnerWithUs, 'kn', '/partner-with-us');

      expect(en.html).toMatch(/<html lang="en"/);
      expect(kn.html).toMatch(/<html lang="kn"/);
      expect(en.html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/partner-with-us">`);
      expect(en.html).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/partner-with-us">`);
      expect(kn.html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/kn/partner-with-us">`);
      expect(kn.html).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/partner-with-us">`);
    });
  });

  describe('i18n coverage', () => {
    it('renders the form heading/submit label via t() in both languages', async () => {
      const en = await renderPage(PartnerWithUs, 'en', '/partner-with-us');
      expect(en.html).toContain(t('en', 'partnerWithUs.form.heading'));
      expect(en.html).toContain(t('en', 'partnerWithUs.form.submit'));

      const kn = await renderPage(PartnerWithUs, 'kn', '/partner-with-us');
      expect(kn.html).toContain(t('kn', 'partnerWithUs.form.heading'));
      expect(kn.html).toContain(t('kn', 'partnerWithUs.form.submit'));
    });
  });
});
