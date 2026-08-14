/**
 * GET /ward/{id}/boundary.json — one ward's boundary polygon as GeoJSON,
 * for src/islands/WardMap.ts (spec §4).
 *
 * NOT under /api/ on purpose. `deploy/nginx/conf.d/site.conf`'s
 * `location /api/` has no proxy_cache and carries `limit_req zone=api`, a
 * zone shared with the write endpoints — wrong for an asset fetched during
 * ordinary ward browsing. Here the route falls into the general public
 * `location /`, which already strips the Cookie header on the way in,
 * ignores Set-Cookie on the way back, and micro-caches for 60s.
 *
 * Consequently this route MUST behave like any other public page: it reads
 * no session and sets no cookie. Ward boundaries are public record, so
 * there is nothing to authorize.
 *
 * Not localized — geometry has no language. There is no /kn/ twin.
 */
import type { APIRoute } from 'astro';
import { loadWardPolygons, wardBoundaryFeature } from '../../../lib/geo';

const NOT_FOUND = JSON.stringify({ error: 'not found' });

function notFound(): Response {
  return new Response(NOT_FOUND, {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ params }) => {
  const wardId = Number(params.id);
  if (!Number.isInteger(wardId)) return notFound();

  // Idempotent (geo.ts's own module-level guard) — the 3.5MB parse happens
  // once per process, on whichever path needs it first.
  await loadWardPolygons();

  const feature = wardBoundaryFeature(wardId);
  if (!feature) return notFound();

  return new Response(JSON.stringify(feature), {
    status: 200,
    headers: { 'content-type': 'application/geo+json' },
  });
};
