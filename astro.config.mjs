import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

/**
 * Parses `EXTRA_ALLOWED_ORIGIN` into one `security.allowedDomains` entry.
 * See the call site below for when this is (and isn't) used. An omitted
 * `port` matches any port — Astro's matcher treats an absent pattern port
 * as a wildcard (`matchPort` in @astrojs/internal-helpers/remote).
 */
function extraAllowedDomain(origin) {
  const url = new URL(origin);
  return {
    hostname: url.hostname,
    protocol: url.protocol.replace(':', ''),
    ...(url.port ? { port: url.port } : {}),
  };
}

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  site: process.env.SITE_ORIGIN ?? 'https://bangalore-votes.opencity.in',
  i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
  vite: {
    build: {
      // Bug found by Task 64's Playwright smoke suite (lookup.spec.ts):
      // Astro's own build (core/build/plugins/plugin-scripts.js) silently
      // INLINES a hoisted `<script>`'s compiled output directly into the
      // page HTML — with no `nonce` attribute at all — whenever that
      // script's bundled chunk is small enough to pass Vite's default
      // `assetsInlineLimit` (4096 bytes) AND isn't imported by another JS
      // chunk. That happened for Home.astro's WardLookup init script and
      // Base.astro's MeSlot init script (both small, single-consumer) while
      // the larger RegisterLoginModal/FlagModal/VoteModal island scripts
      // (>4KB each) stayed external and were unaffected. src/lib/csp.ts's
      // `script-src 'self' 'nonce-...'` policy has no `'unsafe-inline'` and
      // no hash for that silently-inlined code, so real browsers block it
      // outright — the WardLookup/MeSlot islands never actually ran, and a
      // real visitor's "Find my ward" submit silently fell through to a
      // native full-page form POST, which src/middleware.ts's own
      // Origin/Sec-Fetch-Site check then rejects with 403 (no Origin header
      // on that kind of same-origin navigation). Setting this to 0 forces
      // EVERY hoisted script to always build as an external, cacheable,
      // same-origin file — consistent with the CSP policy's assumption that
      // no un-nonced inline script ever exists in the shipped HTML.
      assetsInlineLimit: 0,
    },
  },
  security: {
    // Astro's Node standalone adapter refuses to trust ANY incoming Host
    // header (direct or X-Forwarded-Host) unless it matches an entry here —
    // without this, `security.checkOrigin`'s same-origin check (on by
    // default) always computes the server-side origin as `http://localhost`
    // and 403s every real POST, including the no-JS ward-lookup form
    // fallback (Home.astro) submitted from a real browser on either of this
    // platform's two locked-in hostnames (architecture.md §14: production +
    // staging on one Droplet, both behind the shared nginx).
    allowedDomains: [
      { hostname: 'bangalore-votes.opencity.in', protocol: 'https' },
      { hostname: 'staging.bangalore-votes.opencity.in', protocol: 'https' },
      // Task 64's Playwright smoke suite hits the SAME Node standalone
      // adapter directly (no nginx in front) at http://127.0.0.1:4321 —
      // without its own allowedDomains entry, EVERY form-urlencoded POST
      // there (the curator accept/reject forms, the no-JS ward-lookup
      // fallback) 403s for the exact reason described above ("Cross-site
      // POST form submissions are forbidden": Origin is the real
      // http://127.0.0.1:4321, but Astro's computed origin falls back to
      // http://localhost). Only added when E2E_ALLOWED_HOST is explicitly
      // set at BUILD time (this whole `security` block, like `site` above,
      // is resolved once at build time, not read per-request) — the e2e
      // build step is the only place that ever sets it; it must never be
      // set for a real prod/staging build.
      ...(process.env.E2E_ALLOWED_HOST
        ? [{ hostname: process.env.E2E_ALLOWED_HOST, protocol: 'http', port: process.env.E2E_ALLOWED_PORT }]
        : []),
      // One escape hatch for a TEMPORARY deployment on a hostname that
      // isn't either of the two above — currently the interim Hostinger VPS
      // standing in until the DigitalOcean Droplet of §14 is provisioned.
      // This whole block is resolved once at BUILD time (same as `site`
      // above), so a build served from any other origin rejects EVERY
      // unsafe-method request with 403 — including `POST /api/ward-lookup`,
      // the site's primary feature — unless that origin is listed here.
      // Distinct from E2E_ALLOWED_HOST above deliberately: that one is the
      // Playwright suite's, is http-only and port-pinned, and its own
      // comment says it must never be set for a non-e2e build.
      // Set to a full origin (`http://host[:port]`). Unset — the normal
      // case, and every CI/staging/production build — this is a no-op.
      ...(process.env.EXTRA_ALLOWED_ORIGIN ? [extraAllowedDomain(process.env.EXTRA_ALLOWED_ORIGIN)] : []),
    ],
  },
});
