import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The nginx site config is not run by the suite, so the lines that matter
 * are pinned by reading it (the same approach as tests/unit/deploy-script.test.ts).
 */
const site = readFileSync(new URL('../../deploy/nginx/conf.d/site.conf', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../deploy/nginx/nginx.conf', import.meta.url), 'utf8');

/** The body of the `location <path> { ... }` block, or null. */
function locationBlock(path: string): string | null {
  const start = site.indexOf(`location ${path} {`);
  if (start === -1) return null;
  return site.slice(start, site.indexOf('\n  }', start));
}

describe('nginx static data', () => {
  // `.geojson` is not in the stock mime.types, so without an explicit type the
  // boundary file went out as application/octet-stream.
  it('serves /data/gba.geojson as application/geo+json', () => {
    const block = locationBlock('/data/gba.geojson');
    expect(block).not.toBeNull();
    expect(block).toContain('default_type application/geo+json;');
  });

  it('compresses that type', () => {
    const gzipTypes = main.slice(main.indexOf('gzip_types'), main.indexOf(';', main.indexOf('gzip_types')));
    expect(gzipTypes).toContain('application/geo+json');
  });
});

describe('nginx static asset caching (tracker 201)', () => {
  const fixed = locationBlock('~ ^/(?:fonts/|img/|favicon\\.ico$)');
  const astro = locationBlock('/_astro/');

  it('keeps hashed /_astro/ files one-year immutable, with one Cache-Control', () => {
    expect(astro).toContain('add_header Cache-Control "public, max-age=31536000, immutable" always;');
    expect(astro?.match(/Cache-Control/g)).toHaveLength(1);
  });

  it('gives fixed-name /fonts, /img and /favicon.ico a 7-day cache, never immutable', () => {
    expect(fixed).not.toBeNull();
    expect(fixed).toContain('root /srv/static;');
    expect(fixed).toContain('add_header Cache-Control "public, max-age=604800";');
    expect(fixed).not.toContain('immutable');
    expect(fixed).not.toContain('expires'); // `expires` would add a second Cache-Control
    expect(fixed?.match(/Cache-Control/g)).toHaveLength(1);
  });

  it('re-includes the security headers, since the location sets its own add_header', () => {
    expect(fixed).toContain('include /etc/nginx/snippets/security-headers.conf;');
  });

  it('does not cache 404s for a week (no `always` on the fixed-name header)', () => {
    expect(fixed).not.toMatch(/Cache-Control[^\n]*always/);
  });

  it('leaves the public page location on the micro-cache', () => {
    const pages = locationBlock('/');
    expect(pages).toContain('proxy_cache_valid 200 60s;');
    expect(pages).toContain('proxy_set_header Cookie "";');
    expect(pages).not.toContain('Cache-Control');
  });
});
