import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Base from '../../src/layouts/Base.astro';
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
    // Same mechanism as tests/routes/attribution.test.ts's renderBase: the
    // container API only bakes a real nonce into `Astro.locals.cspNonce`
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

describe('Base layout (design-system.md §7.1/§7.2, IA §1)', () => {
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

  it('renders all 7 footer links with locale-correct hrefs and labels', () => {
    const enLinks: Array<[string, string]> = [
      ['/about', 'About this project'],
      ['/voting-guide', 'Voting guide'],
      ['/data', 'Our data &amp; sources'],
      ['/partner-with-us', 'Partner with us'],
      ['/press', 'Press'],
      ['/terms', 'Terms of use'],
      ['/privacy', 'Privacy policy'],
    ];
    for (const [path, label] of enLinks) {
      expect(enHtml).toContain(`href="${path}">${label}<`);
      expect(knHtml).toContain(`href="/kn${path}">`);
    }
  });

  it('renders the Sign in control anonymously with the MeSlot hook', () => {
    expect(enHtml).toMatch(/data-me-slot[^>]*>Sign in</);
    expect(enHtml).toContain(`href="${localePath('en', '/login')}"`);
    expect(knHtml).toContain('data-me-slot');
    expect(knHtml).toContain(`href="${localePath('kn', '/login')}"`);
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
 * unset — the test/CI default — and stays unperturbed by it.
 */
describe('Base layout — Google Analytics gating (Task 58)', () => {
  const ORIGINAL_GA_ID = process.env.GA_MEASUREMENT_ID;

  afterEach(() => {
    if (ORIGINAL_GA_ID === undefined) delete process.env.GA_MEASUREMENT_ID;
    else process.env.GA_MEASUREMENT_ID = ORIGINAL_GA_ID;
  });

  it('GA_MEASUREMENT_ID unset (test/CI default): no GA snippet at all, on any page', async () => {
    delete process.env.GA_MEASUREMENT_ID;
    const html = await renderBase('en', '/ward/57');
    expect(html).not.toContain('googletagmanager.com');
    expect(html).not.toContain('gtag(');
  });

  it('GA_MEASUREMENT_ID set + public (indexable) page: renders the async loader + inline config, BOTH carrying the real per-request CSP nonce', async () => {
    process.env.GA_MEASUREMENT_ID = 'G-TEST123456';
    const GA_NONCE = 'test-nonce-123';
    // Supply a real `locals.cspNonce`, same mechanism as
    // tests/routes/attribution.test.ts's renderBase, so `Astro.locals.cspNonce`
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
    const html = await renderBase('en', '/account', { noindex: true });

    expect(html).not.toContain('googletagmanager.com');
    expect(html).not.toContain('gtag(');
  });
});
