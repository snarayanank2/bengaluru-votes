import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Base from '../../src/layouts/Base.astro';
import {
  ATTRIBUTION_SCRIPT_SOURCE,
  SRC_COOKIE_NAME,
  SRC_COOKIE_MAX_AGE_SECONDS,
  SRC_SLUG_PATTERN,
  isValidSrcSlug,
} from '../../src/lib/attribution';

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const NONCE = 'test-nonce-abc123==';

/**
 * Same normalization as tests/routes/layout.test.ts — the container API (dev
 * mode) decorates elements with debug attributes and can leave incidental
 * whitespace that never appears in a production `astro build`.
 */
function normalize(html: string): string {
  return html
    .replace(/\s+data-astro-cid-\w+/g, '')
    .replace(/\s+data-astro-(?:source-file|source-loc)="[^"]*"/g, '')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+/g, ' ');
}

async function renderBase(requestUrl: string, cspNonce = NONCE): Promise<string> {
  const container = await AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
  const html = await container.renderToString(Base, {
    partial: false,
    request: new Request(requestUrl),
    locals: { cspNonce } as App.Locals,
    props: {
      lang: 'en',
      title: 'Test page',
      description: 'Test description',
      path: '/ward/57',
    },
  });
  return normalize(html);
}

describe('?src attribution cookie writer (architecture.md §5/§13, PRD §5.12)', () => {
  describe('ATTRIBUTION_SCRIPT_SOURCE (src/lib/attribution.ts)', () => {
    it('is a dependency-free script: no import/require/export', () => {
      expect(ATTRIBUTION_SCRIPT_SOURCE).not.toMatch(/\bimport\b/);
      expect(ATTRIBUTION_SCRIPT_SOURCE).not.toMatch(/\brequire\(/);
      expect(ATTRIBUTION_SCRIPT_SOURCE).not.toMatch(/\bexport\b/);
    });

    it('reads the src param via URLSearchParams(location.search)', () => {
      expect(ATTRIBUTION_SCRIPT_SOURCE).toContain('URLSearchParams');
      expect(ATTRIBUTION_SCRIPT_SOURCE).toContain('location.search');
      expect(ATTRIBUTION_SCRIPT_SOURCE).toMatch(/get\((['"])src\1\)/);
    });

    it('validates against the slug pattern and a max length before storing', () => {
      expect(ATTRIBUTION_SCRIPT_SOURCE).toContain(String(SRC_SLUG_PATTERN));
      expect(ATTRIBUTION_SCRIPT_SOURCE).toContain('.length<=64');
    });

    it('writes the bv_src cookie with 30-day Max-Age, Path=/, SameSite=Lax', () => {
      expect(ATTRIBUTION_SCRIPT_SOURCE).toContain('document.cookie');
      expect(ATTRIBUTION_SCRIPT_SOURCE).toContain(`${SRC_COOKIE_NAME}=`);
      expect(SRC_COOKIE_MAX_AGE_SECONDS).toBe(2592000);
      expect(ATTRIBUTION_SCRIPT_SOURCE).toContain(`Max-Age=${SRC_COOKIE_MAX_AGE_SECONDS}`);
      expect(ATTRIBUTION_SCRIPT_SOURCE).toContain('Path=/');
      expect(ATTRIBUTION_SCRIPT_SOURCE).toContain('SameSite=Lax');
      expect(ATTRIBUTION_SCRIPT_SOURCE).not.toContain('HttpOnly');
    });

    it('is executable and actually implements last-valid-src-wins validation (sandboxed run)', () => {
      // Exercise the real script body in a tiny fake DOM/location, rather than
      // just asserting substrings, so the interpolated pattern/length/cookie
      // name are checked for real behavior too.
      function run(search: string): string | undefined {
        let cookie = '';
        const fakeDocument = {
          get cookie() {
            return cookie;
          },
          set cookie(v: string) {
            cookie = v;
          },
        };
        const fn = new Function('location', 'document', 'URLSearchParams', ATTRIBUTION_SCRIPT_SOURCE);
        fn({ search }, fakeDocument, URLSearchParams);
        return cookie || undefined;
      }

      expect(run('?src=my-partner')).toBe('bv_src=my-partner; Max-Age=2592000; Path=/; SameSite=Lax');
      expect(run('?src=Invalid_Slug')).toBeUndefined();
      expect(run('?src=' + 'a'.repeat(65))).toBeUndefined();
      expect(run('?src=' + 'a'.repeat(64))).toBeDefined();
      expect(run('')).toBeUndefined();
      expect(run('?other=1')).toBeUndefined();
    });
  });

  describe('isValidSrcSlug (unit-testable pure validation)', () => {
    it('accepts lowercase-alphanumeric hyphen-separated slugs up to 64 chars', () => {
      expect(isValidSrcSlug('rwa-koramangala')).toBe(true);
      expect(isValidSrcSlug('a')).toBe(true);
      expect(isValidSrcSlug('a1-b2-c3')).toBe(true);
      expect(isValidSrcSlug('a'.repeat(64))).toBe(true);
    });

    it('rejects empty, oversized, and malformed slugs', () => {
      expect(isValidSrcSlug('')).toBe(false);
      expect(isValidSrcSlug('a'.repeat(65))).toBe(false);
      expect(isValidSrcSlug('Upper')).toBe(false);
      expect(isValidSrcSlug('has_underscore')).toBe(false);
      expect(isValidSrcSlug('-leading')).toBe(false);
      expect(isValidSrcSlug('trailing-')).toBe(false);
      expect(isValidSrcSlug('double--hyphen')).toBe(false);
      expect(isValidSrcSlug('has space')).toBe(false);
      expect(isValidSrcSlug('<script>')).toBe(false);
    });
  });

  describe('cookie name matches the registration read', () => {
    it('src/pages/api/otp/verify.ts reads the SAME cookie name this module writes', () => {
      const verifySource = readFileSync(
        new URL('../../src/pages/api/otp/verify.ts', import.meta.url),
        'utf-8'
      );
      expect(verifySource).toContain(`cookies.get('${SRC_COOKIE_NAME}')`);
    });
  });

  describe('Base.astro output', () => {
    let htmlWithSrc: string;
    let htmlWithoutSrc: string;
    let htmlWithInvalidSrc: string;

    beforeAll(async () => {
      htmlWithSrc = await renderBase(`${SITE_ORIGIN}/ward/57?src=some-partner`);
      htmlWithoutSrc = await renderBase(`${SITE_ORIGIN}/ward/57`);
      htmlWithInvalidSrc = await renderBase(`${SITE_ORIGIN}/ward/57?src=Not_Valid!!`);
    });

    it('renders the inline ?src writer script carrying the request nonce', () => {
      expect(htmlWithoutSrc).toContain(`<script nonce="${NONCE}"`);
      expect(htmlWithoutSrc).toContain(SRC_COOKIE_NAME);
      expect(htmlWithoutSrc).toContain('URLSearchParams');
    });

    it('picks up a per-request nonce (a different request gets a different nonce baked in)', async () => {
      const otherNonceHtml = await renderBase(`${SITE_ORIGIN}/ward/57`, 'different-nonce-xyz');
      expect(otherNonceHtml).toContain('<script nonce="different-nonce-xyz"');
      expect(otherNonceHtml).not.toContain(`nonce="${NONCE}"`);
    });

    it('has no un-nonced inline script (every literal <script ...> tag on the page carries a nonce attribute, GA slot aside)', () => {
      // Every *inline* (is:inline / literal-content) script tag must carry a
      // nonce. Astro's own module-script bundling (the MeSlot mount below)
      // is out of scope here — it is not one of the "two allowed inline
      // scripts" this task is about, and its src-attribute/module form is
      // covered by layout.test.ts.
      const scriptOpenTags = [...htmlWithoutSrc.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      expect(scriptOpenTags.length).toBeGreaterThan(0);
      for (const tag of scriptOpenTags) {
        if (tag.includes('type="module"') || tag.includes("type='module'")) continue;
        expect(tag).toMatch(/\bnonce="[^"]+"/);
      }
    });

    it('CACHE-SAFE: server HTML is byte-identical regardless of ?src (same nonce, only the query string differs)', () => {
      expect(htmlWithSrc).toBe(htmlWithoutSrc);
      expect(htmlWithInvalidSrc).toBe(htmlWithoutSrc);
    });
  });
});
