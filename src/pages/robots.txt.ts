/**
 * `/robots.txt` (Task 57; architecture §8). Allows everything except
 * the same exclusion set the sitemaps deliberately never enumerate
 * (`src/lib/seo/sitemaps.ts`'s module docstring): `/curator`,
 * `/admin`, `/transcribe`, `/api` (each with everything beneath it) and `/login`. Points crawlers at the sitemap index.
 *
 * CACHE-SAFE (architecture §5): identical output for every request — no
 * cookie/session read, no per-visitor branching — so this is a plain
 * public, cacheable response. Deliberately does NOT set `cache-control:
 * no-store` (that's reserved for session-bearing pages elsewhere in this
 * codebase).
 */
import type { APIRoute } from 'astro';

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://bengaluruvotes.opencity.in';

// No trailing slash: a robots.txt rule is a path prefix, so `/curator` covers
// the bare `/curator` URL as well as everything under `/curator/`. With the
// slash the staff entry pages themselves were not matched.
const DISALLOWED_PREFIXES = ['/curator', '/admin', '/transcribe', '/api'];

export const GET: APIRoute = () => {
  const lines = [
    'User-agent: *',
    'Allow: /',
    ...DISALLOWED_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
    'Disallow: /login',
    '',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
