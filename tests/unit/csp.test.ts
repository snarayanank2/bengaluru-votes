import { describe, it, expect } from 'vitest';
import { buildCsp } from '../../src/lib/csp';

const NONCE = 'test-nonce-abc123==';

// Every script-src exact-match assertion below includes these — the Google
// Maps hosts (spec §8) live in the BASE script-src, so they appear on every
// path, partner-with-us included, ahead of the reCAPTCHA hosts that only
// that one path adds. See the "Google Maps hosts" describe block for the
// substring-based coverage of this same fact.
const MAPS_SCRIPT_SRC = 'https://maps.googleapis.com https://maps.gstatic.com';

describe('src/lib/csp.ts#buildCsp', () => {
  describe('base policy (non-partner paths)', () => {
    it.each(['/', '/ward/57', '/candidate/some-slug', '/account', '/api/me', '/kn/ward/57'])(
      '%s: strict script-src with the exact nonce interpolated, no unsafe-inline',
      (pathname) => {
        const csp = buildCsp(NONCE, pathname);
        const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'));
        expect(scriptSrc).toBe(`script-src 'self' 'nonce-${NONCE}' https://www.googletagmanager.com ${MAPS_SCRIPT_SRC}`);
        expect(scriptSrc).not.toContain("'unsafe-inline'");
      },
    );

    it('worker-src allows blob: (Google Maps JS API web worker)', () => {
      const csp = buildCsp(NONCE, '/ward/57');
      expect(csp).toContain("worker-src 'self' blob:");
    });

    it('frame-ancestors is none', () => {
      const csp = buildCsp(NONCE, '/ward/57');
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('frame-src is none on a non-partner path', () => {
      const csp = buildCsp(NONCE, '/ward/57');
      expect(csp).toContain("frame-src 'none'");
    });

    it('style-src allows unsafe-inline (Astro scoped styles / inline style attrs)', () => {
      const csp = buildCsp(NONCE, '/ward/57');
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    });

    it('base-uri, object-src, form-action, default-src are locked down', () => {
      const csp = buildCsp(NONCE, '/ward/57');
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("form-action 'self'");
    });

    it('img-src / connect-src carry the GA hosts (harmless on non-GA pages)', () => {
      const csp = buildCsp(NONCE, '/ward/57');
      expect(csp).toContain('img-src \'self\' data: https://www.googletagmanager.com https://*.google-analytics.com');
      expect(csp).toContain(
        "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
      );
    });

    it.each(['/ward/57', '/account', '/api/me', '/', '/kn/ward/57', '/partner/some-slug'])(
      '%s (non-partner-with-us path) does NOT contain www.google.com in script-src',
      (pathname) => {
        const csp = buildCsp(NONCE, pathname);
        expect(csp).not.toContain('www.google.com');
        expect(csp).not.toContain('www.gstatic.com');
      },
    );
  });

  describe('partner-with-us extension (reCAPTCHA v3)', () => {
    it.each(['/partner-with-us', '/kn/partner-with-us'])(
      '%s: adds www.google.com and www.gstatic.com to script-src',
      (pathname) => {
        const csp = buildCsp(NONCE, pathname);
        const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'));
        expect(scriptSrc).toBe(
          `script-src 'self' 'nonce-${NONCE}' https://www.googletagmanager.com ${MAPS_SCRIPT_SRC} https://www.google.com https://www.gstatic.com`,
        );
      },
    );

    it.each(['/partner-with-us', '/kn/partner-with-us'])('%s: sets frame-src to www.google.com', (pathname) => {
      const csp = buildCsp(NONCE, pathname);
      expect(csp).toContain('frame-src https://www.google.com');
      expect(csp).not.toContain("frame-src 'none'");
    });

    it.each(['/partner-with-us/', '/kn/partner-with-us/'])(
      '%s: trailing-slash variant (Astro trailingSlash: "ignore") still relaxes the CSP',
      (pathname) => {
        const csp = buildCsp(NONCE, pathname);
        const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'));
        expect(scriptSrc).toBe(
          `script-src 'self' 'nonce-${NONCE}' https://www.googletagmanager.com ${MAPS_SCRIPT_SRC} https://www.google.com https://www.gstatic.com`,
        );
        expect(csp).toContain('frame-src https://www.google.com');
      },
    );

    it('does not relax a path that merely starts with /partner-with-us (e.g. a trailing segment)', () => {
      const csp = buildCsp(NONCE, '/partner-with-us-extra');
      expect(csp).not.toContain('www.google.com');
      expect(csp).toContain("frame-src 'none'");
    });

    it('does not relax /partner/:slug (a different route than /partner-with-us)', () => {
      const csp = buildCsp(NONCE, '/partner/some-partner-slug');
      expect(csp).not.toContain('www.google.com');
      expect(csp).toContain("frame-src 'none'");
    });

    it('does not relax a genuine subpath even after trailing-slash normalization', () => {
      const csp = buildCsp(NONCE, '/partner-with-us/sub');
      expect(csp).not.toContain('www.google.com');
      expect(csp).toContain("frame-src 'none'");
    });
  });

  it('is a pure function: same inputs always produce the same output', () => {
    expect(buildCsp(NONCE, '/ward/57')).toBe(buildCsp(NONCE, '/ward/57'));
    expect(buildCsp('other-nonce', '/partner-with-us')).toBe(buildCsp('other-nonce', '/partner-with-us'));
  });

  describe('Google Maps hosts (spec §8)', () => {
    const MAPS_HOSTS = ['https://maps.googleapis.com', 'https://maps.gstatic.com'];

    it.each(['script-src', 'connect-src', 'img-src'])('allows the maps hosts in %s', (directive) => {
      const csp = buildCsp('n0nce', '/ward/1');
      const found = csp.split('; ').find((d) => d.startsWith(`${directive} `));
      expect(found).toBeDefined();
      for (const host of MAPS_HOSTS) expect(found).toContain(host);
    });

    // Regression: verified in a real browser on 2026-08-14. The Maps JS API
    // pulls its UI font and icon stylesheets from fonts.googleapis.com, which
    // the base policy blocked — three `violates the following Content
    // Security Policy directive: "style-src …"` errors per ward page load.
    // This is the one Maps failure the island's fallback CANNOT catch: a
    // blocked subresource fails AFTER `container.textContent = ''`, so the
    // visitor gets a broken map rather than the server-rendered fallback.
    it('allows the Google font hosts the Maps JS API loads', () => {
      const directives = buildCsp('n0nce', '/ward/1').split('; ');

      const styleSrc = directives.find((d) => d.startsWith('style-src '));
      expect(styleSrc).toContain('https://fonts.googleapis.com');

      const fontSrc = directives.find((d) => d.startsWith('font-src '));
      expect(fontSrc).toContain('https://fonts.gstatic.com');
    });

    // fonts.gstatic.com serves the font FILES, maps.gstatic.com serves map
    // assets, and www.gstatic.com is reCAPTCHA's — three different hosts that
    // differ only by subdomain. Pin them so a future edit can't collapse one
    // into another and silently widen the policy.
    it('keeps the three gstatic hosts distinct', () => {
      const directives = buildCsp('n0nce', '/ward/1').split('; ');

      const fontSrc = directives.find((d) => d.startsWith('font-src '));
      expect(fontSrc).not.toContain('https://maps.gstatic.com');
      expect(fontSrc).not.toContain('https://www.gstatic.com');

      const scriptSrc = directives.find((d) => d.startsWith('script-src '));
      expect(scriptSrc).not.toContain('https://fonts.gstatic.com');
    });

    it('keeps the maps hosts on every route, not just the ward page', () => {
      for (const path of ['/', '/kn/', '/voting-guide', '/partner-with-us']) {
        expect(buildCsp('n0nce', path)).toContain('https://maps.googleapis.com');
      }
    });

    it('still adds the reCAPTCHA hosts on /partner-with-us only', () => {
      expect(buildCsp('n0nce', '/partner-with-us')).toContain('https://www.gstatic.com');
      expect(buildCsp('n0nce', '/ward/1')).not.toContain('https://www.gstatic.com');
    });

    it('still forbids unsafe-inline in script-src', () => {
      const csp = buildCsp('n0nce', '/ward/1');
      const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '));
      expect(scriptSrc).toBeDefined();
      // Strengthened from a whole-policy substring check (which passed only
      // incidentally — style-src's 'unsafe-inline' happens to be followed by
      // `;` rather than a space, so `not.toContain("'unsafe-inline' ")`
      // against the full CSP would silently stop testing anything if
      // directive order ever changed) to asserting against the script-src
      // directive specifically, where the nonce-only posture actually lives.
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });
  });
});
