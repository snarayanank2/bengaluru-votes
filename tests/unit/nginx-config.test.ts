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
