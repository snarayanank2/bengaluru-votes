/**
 * Coverage for src/pages/ward/[id]/boundary.json.ts — the per-ward boundary
 * GeoJSON the map island fetches (spec §4). This route is PUBLIC and CACHED
 * by nginx's general `location /` block, so the cache-safety rule of
 * architecture §5 applies: it must never set a cookie.
 */
import { describe, it, expect } from 'vitest';
import { GET } from '../../src/pages/ward/[id]/boundary.json';
import { loadWardPolygons, wardForPoint } from '../../src/lib/geo';

async function call(id: string): Promise<Response> {
  return (await GET({ params: { id } } as never)) as Response;
}

describe('GET /ward/[id]/boundary.json', () => {
  it('returns a GeoJSON Feature for a real ward', async () => {
    await loadWardPolygons();
    const wardId = wardForPoint(12.9716, 77.5946);
    expect(wardId).not.toBeNull();

    const res = await call(String(wardId));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.type).toBe('Feature');
    expect(body.properties.wardId).toBe(wardId);
    expect(['Polygon', 'MultiPolygon']).toContain(body.geometry.type);
  });

  it('404s an unknown ward id', async () => {
    const res = await call('999999');
    expect(res.status).toBe(404);
  });

  it('404s a non-numeric ward id', async () => {
    const res = await call('not-a-number');
    expect(res.status).toBe(404);
  });

  it('never sets a cookie (public cached route — architecture §5)', async () => {
    await loadWardPolygons();
    const wardId = wardForPoint(12.9716, 77.5946);
    const res = await call(String(wardId));
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
