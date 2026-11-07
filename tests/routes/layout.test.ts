import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Base from '../../src/layouts/Base.astro';
import { readFileSync } from 'node:fs';
import { localePath, otherLang, type Lang } from '../../src/i18n';

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

/**
 * The container API (run in dev mode) decorates every element with
 * `data-astro-source-file="..."`/`data-astro-source-loc="..."` debug
 * attributes and Astro's JSX-like whitespace can leave incidental spaces
 * around text nodes. Neither is meaningful to these assertions (they don't
 * appear in a production `astro build`), so strip/collapse them before
 * checking content.
 */
function normalize(html: string): string {
  return html
    .replace(/\s+data-astro-cid-\w+/g, '')
    .replace(/\s+data-astro-(?:source-file|source-loc)="[^"]*"/g, '')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+/g, ' ');
}

async function renderBase(
  lang: Lang,
  path: string,
  extraProps: Record<string, unknown> = {},
  locals: Record<string, unknown> = {},
) {
  const container = await AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
  const html = await container.renderToString(Base, {
    partial: false,
    // The container API only bakes a real nonce into `Astro.locals.cspNonce`
    // (src/layouts/Base.astro) when one is supplied here — otherwise the
    // `nonce={cspNonce}` attributes render as nothing at all. Defaults to
    // `{}` (no nonce) so every OTHER case in this file, which doesn't care
    // about the nonce, is unaffected.
    locals: locals as unknown as App.Locals,
    props: {
      lang,
      title: 'Test page',
      description: 'Test description',
      path,
      ...extraProps,
    },
  });
  return normalize(html);
}

describe('Base layout (design-system.md §7.1/§7.2)', () => {
  let enHtml: string;
  let knHtml: string;

  beforeAll(async () => {
    enHtml = await renderBase('en', '/ward/57');
    knHtml = await renderBase('kn', '/ward/57');
  });

  it('sets <html lang> to the page language', () => {
    expect(enHtml).toMatch(/<html lang="en"/);
    expect(knHtml).toMatch(/<html lang="kn"/);
  });

  it('emits a canonical link built from SITE_ORIGIN + path, never a Host header', () => {
    expect(enHtml).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/ward/57">`);
    expect(knHtml).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/kn/ward/57">`);
  });

  it('emits en, kn, and x-default hreflang alternates, kn URL under /kn/', () => {
    for (const html of [enHtml, knHtml]) {
      expect(html).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/ward/57">`);
      expect(html).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/ward/57">`);
      expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/ward/57">`);
    }
  });

  it('emits OG tags in the page language, including og:locale', () => {
    expect(enHtml).toContain('<meta property="og:locale" content="en_IN">');
    expect(knHtml).toContain('<meta property="og:locale" content="kn_IN">');
    expect(enHtml).toContain(`<meta property="og:url" content="${SITE_ORIGIN}/ward/57">`);
    expect(knHtml).toContain(`<meta property="og:url" content="${SITE_ORIGIN}/kn/ward/57">`);
  });

  it('omits the robots meta by default, and emits it when noindex is set', async () => {
    expect(enHtml).not.toMatch(/name="robots"/);
    const noindexHtml = await renderBase('en', '/x', { noindex: true });
    expect(noindexHtml).toContain('<meta name="robots" content="noindex">');
  });

  it('renders the language toggle pointing at the other language for the same path, both scripts always present', () => {
    expect(enHtml).toContain(`href="${localePath(otherLang('en'), '/ward/57')}"`);
    expect(knHtml).toContain(`href="${localePath(otherLang('kn'), '/ward/57')}"`);
    expect(enHtml).toMatch(/>EN</);
    expect(enHtml).toMatch(/>ಕನ್ನಡ</);
    expect(knHtml).toMatch(/>EN</);
    expect(knHtml).toMatch(/>ಕನ್ನಡ</);
  });

  it('renders the reference partner lockup without replacing the Bengaluru Votes brand', () => {
    expect(enHtml).toContain('>Bengaluru Votes<');
    expect(enHtml).toContain('src="/img/opencity-logo.png"');
    expect(enHtml).toContain('src="/img/janaagraha-logo.png"');
    expect(enHtml).toContain('class="header-separator"');
    expect(enHtml).toContain('class="header-star"');
  });

  it('renders footer links with locale-correct hrefs and omits the retired data page', () => {
    const enLinks: Array<[string, string]> = [
      ['/about', 'About Bengaluru Votes'],
      ['/voter-faqs', 'Voter FAQs'],
      ['/terms', 'Terms of use'],
      ['/privacy', 'Privacy policy'],
    ];
    for (const [path, label] of enLinks) {
      expect(enHtml).toContain(`href="${path}">${label}<`);
      expect(knHtml).toContain(`href="/kn${path}">`);
    }
    expect(enHtml).not.toContain('href="/data"');
    expect(knHtml).not.toContain('href="/kn/data"');
    expect(enHtml).not.toContain('Our data &amp; sources');
  });

  it('links Donate directly to Oorvani in both languages, preserving translated labels', () => {
    expect(enHtml).toContain('href="https://oorvani.org/support-us">Donate<');
    expect(knHtml).toContain('href="https://oorvani.org/support-us">ದೇಣಿಗೆ ನೀಡಿ<');
    for (const html of [enHtml, knHtml]) {
      expect(html).not.toContain('href="/donate"');
      expect(html).not.toContain('href="/kn/donate"');
    }
  });

  it('brands the partner footer with a prominent platform name, light self-hosted marks, and white social icons', () => {
    for (const html of [enHtml, knHtml]) {
      // Self-hosted under public/img/ — a remote src would be blocked by the
      // app's own `img-src 'self'` CSP (src/lib/csp.ts).
      expect(html).toContain('src="/img/janaagraha-logo.svg"');
      expect(html).toContain('src="/img/oorvani-logo-white.png"');
      expect(html).toContain('alt="Janaagraha"');
      expect(html).toContain('alt="Oorvani Foundation"');
      expect(html).not.toContain('partner-chip');

      const footer = html.slice(html.indexOf('class="site-footer"'));
      expect(footer).toContain('<p class="footer-brand">Bengaluru Votes</p>');
      expect(footer.indexOf('class="footer-brand"')).toBeLessThan(
        footer.indexOf('class="partners-label"'),
      );
    }
    expect(enHtml).toContain('A joint project by');
  });

  it('puts the joint-project block first and separates the three footer columns', () => {
    const partners = enHtml.indexOf('class="footer-partners"');
    const firstColumn = enHtml.indexOf('class="footer-link-column footer-link-column--divided"');
    expect(partners).toBeGreaterThanOrEqual(0);
    expect(firstColumn).toBeGreaterThan(partners);
    expect(enHtml.match(/class="footer-link-column footer-link-column--divided"/g)).toHaveLength(2);
  });

  it('puts the donation and legal links under the OpenCity logo in column three', () => {
    const footer = enHtml.slice(enHtml.indexOf('class="site-footer"'));
    const thirdColumn = footer.indexOf('aria-label="More footer links"');
    const thirdColumnHtml = footer.slice(thirdColumn);
    expect(thirdColumnHtml).toContain('src="/img/opencity-wordmark.png"');
    expect(thirdColumnHtml.indexOf('src="/img/opencity-wordmark.png"')).toBeLessThan(
      thirdColumnHtml.indexOf('href="https://oorvani.org/support-us"'),
    );
    expect(thirdColumnHtml).toContain('href="/terms">Terms of use<');
    expect(thirdColumnHtml).toContain('href="/privacy">Privacy policy<');
    expect(footer.slice(0, thirdColumn)).not.toContain('href="https://oorvani.org/support-us"');
  });

  it('renders the three social links with accessible names and safe rel (§7.2)', () => {
    const accounts: Array<[string, string]> = [
      ['https://x.com/opencity_in', 'X'],
      ['https://www.linkedin.com/company/74925255', 'LinkedIn'],
      ['https://instagram.com/opencity.in', 'Instagram'],
    ];
    for (const html of [enHtml, knHtml]) {
      for (const [href, label] of accounts) {
        // Icon-only links: the platform name is the accessible name, so it
        // must never be dropped from the anchor.
        expect(html).toContain(`href="${href}" aria-label="${label}"`);
      }
      // …and every one of them opens out of the app safely. Scoped to the
      // social list: other components have their own external links.
      const social = html.slice(html.indexOf('class="social-links"'));
      const list = social.slice(0, social.indexOf('</ul>'));
      expect(list.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(
        accounts.length,
      );
    }
  });

  it('does not render the temporarily removed header sign-in control', () => {
    expect(enHtml).not.toContain('class="sign-in"');
    expect(enHtml).not.toContain('data-me-slot');
    expect(knHtml).not.toContain('class="sign-in"');
    expect(knHtml).not.toContain('data-me-slot');
  });

  it('renders the skip link and a main landmark with matching id', () => {
    expect(enHtml).toContain('href="#main-content"');
    expect(enHtml).toMatch(/<main id="main-content"/);
  });
});

/**
 * GA gating (Task 58, src/lib/analytics.ts) — kept in its own describe
 * block, toggling `GA_MEASUREMENT_ID` only for these cases, so the main
 * describe block above (and every other suite) keeps running with GA
 * unset — the test default — and stays unperturbed by it.
 */
describe('Base layout — Google Analytics gating (Task 58)', () => {
  const ORIGINAL_GA_ID = process.env.GA_MEASUREMENT_ID;

  afterEach(() => {
    if (ORIGINAL_GA_ID === undefined) delete process.env.GA_MEASUREMENT_ID;
    else process.env.GA_MEASUREMENT_ID = ORIGINAL_GA_ID;
  });

  it('GA_MEASUREMENT_ID unset (test default): no GA snippet at all, on any page', async () => {
    delete process.env.GA_MEASUREMENT_ID;
    const html = await renderBase('en', '/ward/57');
    expect(html).not.toContain('googletagmanager.com');
    expect(html).not.toContain('gtag(');
  });

  it('GA_MEASUREMENT_ID set + public (indexable) page: renders the async loader + inline config, BOTH carrying the real per-request CSP nonce', async () => {
    process.env.GA_MEASUREMENT_ID = 'G-TEST123456';
    const GA_NONCE = 'test-nonce-123';
    // Supply a real `locals.cspNonce` so `Astro.locals.cspNonce`
    // (src/layouts/Base.astro) resolves to a KNOWN value we can assert on
    // exactly — rather than leaving it unset, which would let the nonce
    // attribute silently disappear from both GA `<script>` tags without
    // failing this test.
    const html = await renderBase('en', '/ward/57', {}, { cspNonce: GA_NONCE });

    // Nonce is MANDATORY here (not optional) on both GA script tags — the
    // async gtag.js loader and the inline config — matching what
    // src/layouts/Base.astro actually emits (`nonce={cspNonce}` on each).
    // If `nonce={cspNonce}` were ever deleted from either tag, these two
    // assertions would fail.
    expect(html).toMatch(
      /<script async nonce="test-nonce-123" src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-TEST123456"/,
    );
    expect(html).toContain("gtag('config',\"G-TEST123456\")");
    expect(html).toMatch(/<script nonce="test-nonce-123">window\.dataLayer/);
  });

  it('GA_MEASUREMENT_ID set but noindex (an authenticated-shaped page): renders NO GA snippet', async () => {
    process.env.GA_MEASUREMENT_ID = 'G-TEST123456';
    const html = await renderBase('en', '/curator', { noindex: true });

    expect(html).not.toContain('googletagmanager.com');
    expect(html).not.toContain('gtag(');
  });
});

describe('Base layout inline scripts carry the per-request CSP nonce (architecture §13)', () => {
  const NONCE = 'test-nonce-abc123==';
  const JSON_LD = [{ '@context': 'https://schema.org', '@type': 'AdministrativeArea', name: 'Test Ward' }];

  async function renderWithNonce(requestUrl: string, cspNonce = NONCE): Promise<string> {
    const container = await AstroContainer.create({
      astroConfig: {
        site: SITE_ORIGIN,
        i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
      },
    });
    const html = await container.renderToString(Base, {
      partial: false,
      request: new Request(requestUrl),
      locals: { cspNonce } as unknown as App.Locals,
      props: { lang: 'en', title: 'Test page', description: 'Test description', path: '/ward/57', jsonLd: JSON_LD },
    });
    return normalize(html);
  }

  it('renders the JSON-LD block carrying the request nonce', async () => {
    const html = await renderWithNonce(`${SITE_ORIGIN}/ward/57`);
    expect(html).toContain(`<script type="application/ld+json" nonce="${NONCE}">`);
  });

  it('picks up a per-request nonce (a different request gets a different nonce baked in)', async () => {
    const html = await renderWithNonce(`${SITE_ORIGIN}/ward/57`, 'different-nonce-xyz');
    expect(html).toContain('nonce="different-nonce-xyz"');
    expect(html).not.toContain(`nonce="${NONCE}"`);
  });

  it('has no un-nonced inline script (every non-module <script> tag carries a nonce attribute)', async () => {
    const html = await renderWithNonce(`${SITE_ORIGIN}/ward/57`);
    const scriptOpenTags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    const inline = scriptOpenTags.filter((tag) => !tag.includes('type="module"'));
    expect(inline.length).toBeGreaterThan(0);
    for (const tag of inline) expect(tag).toMatch(/\bnonce="[^"]+"/);
  });

  it('CACHE-SAFE: server HTML is byte-identical regardless of the query string', async () => {
    const plain = await renderWithNonce(`${SITE_ORIGIN}/ward/57`);
    expect(await renderWithNonce(`${SITE_ORIGIN}/ward/57?utm_source=whatsapp`)).toBe(plain);
    expect(await renderWithNonce(`${SITE_ORIGIN}/ward/57?lang=kn&x=1`)).toBe(plain);
  });
});

describe('shared page CSS (src/styles/global.css)', () => {
  const css = readFileSync('src/styles/global.css', 'utf8');
  /** The first top-level rule with exactly this selector, or ''. */
  function rule(selector: string): string {
    const start = css.indexOf(`\n${selector} {`);
    return start === -1 ? '' : css.slice(start, css.indexOf('}', start) + 1);
  }

  // A short page (a 404, the sign-in form) must still put the footer on the bottom edge.
  it('makes the body a viewport-tall column and <main> take the slack', () => {
    const body = rule('body');
    expect(body).toContain('display: flex');
    expect(body).toContain('flex-direction: column');
    expect(body).toContain('min-height: 100dvh');
    expect(rule('body > main')).toContain('flex: 1 0 auto');
  });

  it('defines the shared confirmation tick (26px box in a 48px row) and the key/value list', () => {
    expect(rule('.confirm-tick')).toContain('min-height: 48px');
    expect(rule('.confirm-tick input')).toContain('width: 26px');
    expect(rule('.confirm-tick input')).toContain('height: 26px');
    expect(rule('.kv-list dt')).toContain('font-size: var(--text-xs)');
    expect(rule('.kv-list dt')).toContain('color: var(--color-text-muted)');
  });

  it('PublishConfirm uses the shared tick rather than redefining it', () => {
    const component = readFileSync('src/components/PublishConfirm.astro', 'utf8');
    expect(component).toContain('class="confirm-tick"');
    expect(component).not.toContain('\n  .confirm-tick {');
  });
});
