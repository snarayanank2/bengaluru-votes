/**
 * `/robots.txt` (Task 57). No DB, no cookies — a plain, cache-safe static
 * response, same call convention as tests/routes/healthz.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { GET } from '../../src/pages/robots.txt';

describe('robots.txt (Task 57; architecture §8)', () => {
  it('returns 200 text/plain', async () => {
    const res = await GET({} as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('disallows every excluded prefix and points at the sitemap index', async () => {
    const body = await (await GET({} as any)).text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    // Path prefixes with no trailing slash, so the bare /curator and
    // /transcribe URLs are matched as well as everything beneath them.
    const rules = body.split('\n');
    for (const prefix of ['/transcribe', '/curator', '/admin', '/api']) {
      expect(rules).toContain(`Disallow: ${prefix}`);
      expect(rules).not.toContain(`Disallow: ${prefix}/`);
    }
    expect(body).not.toContain('Disallow: /account');
    expect(body).not.toContain('Disallow: /partner');
    expect(body).toContain('Disallow: /login');
    expect(body).toContain('Sitemap: https://bengaluruvotes.opencity.in/sitemap.xml');
  });

  it('does not set cache-control: no-store (public, cacheable response)', async () => {
    const res = await GET({} as any);
    expect(res.headers.get('cache-control')).not.toBe('no-store');
  });
});
