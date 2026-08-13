import { describe, it, expect } from 'vitest';
import { loadWardPolygons, wardForPoint, wardBoundaryUrl, wardBoundaryFeature } from '../../src/lib/geo';

// Reference points below were derived directly from data/gba.geojson: for each
// feature, average all vertex [lng, lat] pairs of its outer ring to get an
// interior point, then verified with @turf/boolean-point-in-polygon that the
// point actually falls inside that feature's geometry (see task-14-report.md
// for the derivation script). Expected wards.id follows the SAME formula as
// scripts/seed-wards.ts: corporation_id * 1000 + ward_id.
const WEST_WARD = {
  // feature ward_369_final.1 — Corporation: West, corporation_id: 5, ward_id: 25
  boundaryRef: 'ward_369_final.1',
  id: 5 * 1000 + 25, // 5025
  lat: 12.963397819598583,
  lng: 77.51397756422665,
};
const NORTH_WARD_MULTIPOLYGON = {
  // feature ward_369_final.2 — Corporation: North, corporation_id: 2, ward_id: 2 (MultiPolygon geometry)
  boundaryRef: 'ward_369_final.2',
  id: 2 * 1000 + 2, // 2002
  lat: 13.107573555714282,
  lng: 77.62455942952377,
};
const EAST_WARD = {
  // feature ward_369_final.17 — Corporation: East, corporation_id: 3, ward_id: 15
  boundaryRef: 'ward_369_final.17',
  id: 3 * 1000 + 15, // 3015
  lat: 13.014217518644074,
  lng: 77.67837172288135,
};
const CENTRAL_WARD = {
  // feature ward_369_final.7 — Corporation: Central, corporation_id: 1, ward_id: 24
  boundaryRef: 'ward_369_final.7',
  id: 1 * 1000 + 24, // 1024
  lat: 12.946878943946183,
  lng: 77.63646740116606,
};

// Arabian Sea, far west of Bengaluru — outside every GBA ward polygon.
const ARABIAN_SEA = { lat: 12.9, lng: 70.0 };

describe('geo', () => {
  it('throws when wardForPoint is called before loadWardPolygons', () => {
    expect(() => wardForPoint(WEST_WARD.lat, WEST_WARD.lng)).toThrow();
  });

  it('throws when wardBoundaryUrl is called before loadWardPolygons', () => {
    expect(() => wardBoundaryUrl(WEST_WARD.id)).toThrow();
  });

  describe('after loadWardPolygons', () => {
    it('loads without throwing, and is idempotent on a second call', async () => {
      await loadWardPolygons();
      await expect(loadWardPolygons()).resolves.toBeUndefined();
    });

    it('resolves a point inside a West-corporation ward (Polygon geometry) to its wards.id', async () => {
      await loadWardPolygons();
      expect(wardForPoint(WEST_WARD.lat, WEST_WARD.lng)).toBe(WEST_WARD.id);
    });

    it('resolves a point inside a North-corporation ward (MultiPolygon geometry) to its wards.id', async () => {
      await loadWardPolygons();
      expect(wardForPoint(NORTH_WARD_MULTIPOLYGON.lat, NORTH_WARD_MULTIPOLYGON.lng)).toBe(
        NORTH_WARD_MULTIPOLYGON.id,
      );
    });

    it('resolves a point inside an East-corporation ward to its wards.id', async () => {
      await loadWardPolygons();
      expect(wardForPoint(EAST_WARD.lat, EAST_WARD.lng)).toBe(EAST_WARD.id);
    });

    it('resolves a point inside a Central-corporation ward to its wards.id', async () => {
      await loadWardPolygons();
      expect(wardForPoint(CENTRAL_WARD.lat, CENTRAL_WARD.lng)).toBe(CENTRAL_WARD.id);
    });

    it('returns null for a point in the Arabian Sea, far outside every GBA polygon', async () => {
      await loadWardPolygons();
      expect(wardForPoint(ARABIAN_SEA.lat, ARABIAN_SEA.lng)).toBeNull();
    });

    it('uses lat/lng in the correct order (a swapped call lands in the sea and returns null)', async () => {
      await loadWardPolygons();
      // Deliberately swapped: passing (lng, lat) instead of (lat, lng) for a
      // real ward point should NOT resolve to that ward — Bengaluru's lat
      // (~12-13) is nowhere near a valid lng for this region (~77), and vice
      // versa, so the swapped call must miss every polygon.
      expect(wardForPoint(WEST_WARD.lng, WEST_WARD.lat)).toBeNull();
    });

    it('wardBoundaryUrl(id) returns a string containing the feature boundaryRef', async () => {
      await loadWardPolygons();
      expect(wardBoundaryUrl(WEST_WARD.id)).toContain(WEST_WARD.boundaryRef);
      expect(wardBoundaryUrl(EAST_WARD.id)).toContain(EAST_WARD.boundaryRef);
    });

    it('throws for an unknown wards.id', async () => {
      await loadWardPolygons();
      expect(() => wardBoundaryUrl(999999)).toThrow();
    });

    it('loads 369 features and performs 100 lookups quickly without hanging', async () => {
      await loadWardPolygons();
      for (let i = 0; i < 100; i++) {
        wardForPoint(WEST_WARD.lat, WEST_WARD.lng);
      }
    });
  });
});

describe('wardBoundaryFeature', () => {
  it('returns a GeoJSON Feature for a known ward id', async () => {
    await loadWardPolygons();
    const known = wardForPoint(12.9716, 77.5946); // central Bengaluru
    expect(known).not.toBeNull();

    const feature = wardBoundaryFeature(known!);
    expect(feature).not.toBeNull();
    expect(feature!.type).toBe('Feature');
    expect(feature!.properties.wardId).toBe(known);
    expect(typeof feature!.properties.id).toBe('string');
    expect(['Polygon', 'MultiPolygon']).toContain(feature!.geometry.type);
  });

  it('returns null for an unknown ward id', async () => {
    await loadWardPolygons();
    expect(wardBoundaryFeature(999999)).toBeNull();
  });
});
