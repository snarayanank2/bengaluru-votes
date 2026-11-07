import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { localePath, t } from '../../src/i18n';
import NotFoundEn from '../../src/pages/404.astro';
import NotFoundKn from '../../src/pages/kn/404.astro';
import ServerError from '../../src/pages/500.astro';

/**
 * Task 23 — bilingual 404 + 500 error pages and their "helpful links back". Container-rendered like tests/routes/legal.test.ts /
 * tests/routes/ward.test.ts (the latter is also the reference for asserting
 * a real HTTP status out of `container.renderToResponse`, since these pages
 * carry an explicit `Astro.response.status` set in their frontmatter).
 *
 * CACHE-SAFETY: neither page reads app_settings, cookies, or the DB — no
 * migration/DB fixture setup needed here, unlike ward.test.ts/home.test.ts.
 */

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
  Component: any,
  requestPath: string,
): Promise<{ html: string; response: Response }> {
  const container = await makeContainer();
  const response = await container.renderToResponse(Component, {
    partial: false,
    request: new Request(`${SITE_ORIGIN}${requestPath}`),
  });
  const html = normalize(await response.text());
  return { html, response };
}

describe('404 page (Task 23) — friendly not-found', () => {
  it('EN: renders with status 404, noindex, lang="en", and links back to home/voter-faqs', async () => {
    const { html, response } = await renderPage(NotFoundEn, '/some/unknown/path');

    expect(response.status).toBe(404);
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(t('en', 'error.notFound.title'));
    expect(html).toContain(t('en', 'error.notFound.body'));

    expect(html).toContain(`href="${localePath('en', '/')}"`);
    expect(html).toContain(`href="${localePath('en', '/voter-faqs')}"`);
  });

  it('KN: renders with status 404, noindex, lang="kn", and links localized to /kn/...', async () => {
    const { html, response } = await renderPage(NotFoundKn, '/kn/some/unknown/path');

    expect(response.status).toBe(404);
    expect(html).toMatch(/<html lang="kn"/);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(t('kn', 'error.notFound.title'));
    expect(html).toContain(t('kn', 'error.notFound.body'));

    expect(html).toContain(`href="${localePath('kn', '/')}"`);
    expect(html).toContain(`href="${localePath('kn', '/voter-faqs')}"`);
  });

  // Astro renders the EN 404.astro for every URL that matches no route, kn or not;
  // only a matched route returning 404 reaches kn/404.astro. So the EN shim
  // must pick Kannada itself from the requested path.
  it.each(['/kn/nosuchpage', '/kn/some/deeper/path', '/kn'])('EN shim renders the Kannada 404 for the unmatched path %s', async (path) => {
    const { html, response } = await renderPage(NotFoundEn, path);

    expect(response.status).toBe(404);
    expect(html).toMatch(/<html lang="kn"/);
    expect(html).toContain(t('kn', 'error.notFound.title'));
    expect(html).not.toContain(t('en', 'error.notFound.title'));
    expect(html).toContain(`href="${localePath('kn', '/')}"`);
    // The toggle's alternate is the English twin.
    expect(html).toContain('hreflang="en"');
  });

  it('EN shim stays English for a path that only starts like /kn', async () => {
    const { html } = await renderPage(NotFoundEn, '/knowledge/base');
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toContain(t('en', 'error.notFound.title'));
  });

  // The page's only heading; without it screen-reader heading navigation
  // finds nothing on a 404.
  it.each([
    ['EN', NotFoundEn, '/missing', 'en'],
    ['KN', NotFoundKn, '/kn/missing', 'kn'],
  ] as const)('%s 404 has the title as its one H1', async (_label, Page, path, lang) => {
    const { html } = await renderPage(Page, path);
    const h1s = html.match(/<h1\b[^>]*>.*?<\/h1>/g) ?? [];
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toContain(t(lang, 'error.notFound.title'));
  });

  it('does not read any cookie/session — identical markup with/without a cookie on the request, no set-cookie', async () => {
    const container = await makeContainer();
    const plain = await container.renderToResponse(NotFoundEn, {
      partial: false,
      request: new Request(`${SITE_ORIGIN}/x`),
    });
    const withCookie = await container.renderToResponse(NotFoundEn, {
      partial: false,
      request: new Request(`${SITE_ORIGIN}/x`, { headers: { cookie: 'session=abc123' } }),
    });

    expect(plain.headers.get('set-cookie')).toBeNull();
    expect(withCookie.headers.get('set-cookie')).toBeNull();
    expect(normalize(await withCookie.text())).toBe(normalize(await plain.text()));
  });
});

describe('500 page (Task 23) — generic, dependency-light error page', () => {
  it('EN: renders with status 500, noindex, lang="en", and a link home', async () => {
    const { html, response } = await renderPage(ServerError, '/500');

    expect(response.status).toBe(500);
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(t('en', 'error.serverError.title'));
    expect(html).toContain(t('en', 'error.serverError.body'));
    expect(html).toContain(`href="${localePath('en', '/')}"`);
  });

  it('the 500 page has the title as its one H1', async () => {
    const { html } = await renderPage(ServerError, '/500');
    const h1s = html.match(/<h1\b[^>]*>.*?<\/h1>/g) ?? [];
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toContain(t('en', 'error.serverError.title'));
  });

  it('has no DB/settings import — must be renderable during a DB outage', () => {
    const notFoundSrc = readFileSync(new URL('../../src/features/pages/NotFound.astro', import.meta.url), 'utf-8');
    const serverErrorSrc = readFileSync(new URL('../../src/pages/500.astro', import.meta.url), 'utf-8');

    for (const src of [notFoundSrc, serverErrorSrc]) {
      expect(src).not.toContain('db/client');
      expect(src).not.toContain('getSettings');
      expect(src).not.toContain('/db/schema');
    }
  });

  it('renders successfully with no DATABASE_URL set in the environment (no reliance on it)', async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { response } = await renderPage(ServerError, '/500');
      expect(response.status).toBe(500);
    } finally {
      if (previous !== undefined) process.env.DATABASE_URL = previous;
    }
  });
});
