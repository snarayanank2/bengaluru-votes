/**
 * In-memory ward point-in-polygon over the static ward boundary GeoJSON.
 *
 * Per architecture.md §6 ("no PostGIS"), ward geometry lookups do NOT go
 * through the database. `data/gba.geojson` (369 features) is parsed once,
 * lazily, into an in-process index, and this module answers "which ward
 * contains this lat/lng" purely in memory.
 *
 * Two consumers: `lookupWardByAddress` (src/lib/geocode.ts) for
 * point-in-polygon, and `GET /ward/<id>/boundary.json`
 * (src/pages/ward/[id]/boundary.json.ts) for `wardBoundaryFeature` below.
 *
 * The id scheme here MUST match scripts/seed-wards.ts exactly, since the
 * number this module returns is used directly as `wards.id` (a foreign key
 * into the DB). See the derivation notes at the top of scripts/seed-wards.ts
 * for the full source-data investigation; mirrored here:
 *   wards.id       := properties.corporation_id * 1000 + properties.ward_id
 *   boundaryRef    := properties.id (e.g. "ward_369_final.1") — stable
 *                     per-feature identifier, 1:1 with the composite id
 *                     under this scheme (asserted at load time below).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/lib/geo.ts -> src/lib -> src -> project root -> data/gba.geojson
const DEFAULT_GEOJSON_PATH = path.join(__dirname, '..', '..', 'data', 'gba.geojson');

type Position = [number, number, ...number[]]; // GeoJSON [lng, lat, (elevation)]
type PolygonGeometry = { type: 'Polygon'; coordinates: Position[][] };
type MultiPolygonGeometry = { type: 'MultiPolygon'; coordinates: Position[][][] };
type WardGeometry = PolygonGeometry | MultiPolygonGeometry;

type BBox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

type WardFeatureIndex = {
  wardId: number;
  boundaryRef: string;
  geometry: WardGeometry;
  bbox: BBox;
};

// Module-level state. Populated once by loadWardPolygons(); read by
// wardForPoint / wardBoundaryFeature. Not exported — callers only interact
// through the three functions below.
let wardFeatures: WardFeatureIndex[] | null = null;
let wardIdToFeature: Map<number, WardFeatureIndex> | null = null;

function computeBBox(geometry: WardGeometry): BBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visitRing = (ring: Position[]) => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) visitRing(ring);
  } else {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) visitRing(ring);
    }
  }

  return { minLng, minLat, maxLng, maxLat };
}

/**
 * Read data/gba.geojson once and build the in-memory ward index (bbox +
 * geometry per feature, keyed by wards.id). Idempotent: a second (or Nth)
 * call is a no-op — safe to call at every app boot / from multiple modules
 * without re-parsing the file or duplicating the index.
 */
export async function loadWardPolygons(): Promise<void> {
  if (wardFeatures !== null) return; // already loaded — no-op

  const geojson = JSON.parse(readFileSync(DEFAULT_GEOJSON_PATH, 'utf8')) as {
    features: Array<{ properties: Record<string, unknown>; geometry: WardGeometry }>;
  };

  const features: WardFeatureIndex[] = geojson.features.map((feature) => {
    const p = feature.properties;
    const featureRef = String(p.id ?? p.ward_id ?? '(unknown feature)');

    const boundaryRef = String(p.id ?? '').trim();
    if (!boundaryRef) {
      throw new Error(`geo: missing properties.id in feature (ward_id: ${p.ward_id})`);
    }

    const corporationId = Number(p.corporation_id);
    const wardIdProp = Number(p.ward_id);
    if (!Number.isInteger(corporationId) || !Number.isInteger(wardIdProp)) {
      throw new Error(`geo: non-integer corporation_id/ward_id in feature ${featureRef}`);
    }

    const geometry = feature.geometry;
    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
      throw new Error(
        `geo: unsupported geometry type ${(geometry as { type: string }).type} in feature ${featureRef} (expected Polygon or MultiPolygon)`,
      );
    }

    return {
      wardId: corporationId * 1000 + wardIdProp,
      boundaryRef,
      geometry,
      bbox: computeBBox(geometry),
    };
  });

  // Guard the 1:1 wards.id <-> feature invariant this composite-key scheme
  // relies on (mirrors the duplicate guard in scripts/seed-wards.ts).
  const byId = new Map<number, WardFeatureIndex>();
  for (const f of features) {
    if (byId.has(f.wardId)) {
      throw new Error(
        `geo: duplicate wards.id ${f.wardId} across features (${byId.get(f.wardId)!.boundaryRef} and ${f.boundaryRef}) — the composite-id scheme requires 1:1 id-to-feature mapping`,
      );
    }
    byId.set(f.wardId, f);
  }

  wardFeatures = features;
  wardIdToFeature = byId;
}

/** Throws unless loadWardPolygons() has already populated the module state. */
function requireLoaded(): { features: WardFeatureIndex[]; byId: Map<number, WardFeatureIndex> } {
  if (wardFeatures === null || wardIdToFeature === null) {
    throw new Error(
      'geo: loadWardPolygons() has not been called yet — call it before wardForPoint/wardBoundaryFeature',
    );
  }
  return { features: wardFeatures, byId: wardIdToFeature };
}

/**
 * Return the wards.id whose polygon contains (lat, lng), or null if the
 * point falls outside EVERY GBA ward polygon — the explicit out-of-coverage
 * answer (PRD §5.1).
 *
 * NOTE the parameter order: (lat, lng), matching how coordinates are
 * conventionally spoken/written (and how most geocoding APIs return them).
 * GeoJSON — and turf — use the OPPOSITE order, [lng, lat]. This function
 * converts internally; do not pass (lng, lat) here.
 *
 * Throws if loadWardPolygons() has not been called yet (see requireLoaded).
 */
export function wardForPoint(lat: number, lng: number): number | null {
  const { features } = requireLoaded();

  const pt = point([lng, lat]); // turf wants [lng, lat], not [lat, lng]

  for (const feature of features) {
    // Cheap bbox pre-filter before the precise (and pricier) turf test.
    if (
      lng < feature.bbox.minLng ||
      lng > feature.bbox.maxLng ||
      lat < feature.bbox.minLat ||
      lat > feature.bbox.maxLat
    ) {
      continue;
    }

    if (booleanPointInPolygon(pt, feature.geometry)) {
      return feature.wardId;
    }
  }

  return null;
}


/**
 * One ward's boundary as a standalone GeoJSON Feature, for
 * `/ward/<id>/boundary.json` (src/pages/ward/[id]/boundary.json.ts) and the
 * map island that fetches it. Returns null for an id with no matching
 * feature — the route turns that into a 404 rather than throwing, unlike
 * `wardForPoint` above, which answers a different question entirely.
 *
 * `properties` deliberately carries only what the client needs; the raw
 * source properties (corporation_id, ward_id, …) are not forwarded.
 */
export type WardBoundaryFeature = {
  type: 'Feature';
  properties: { id: string; wardId: number };
  geometry: WardGeometry;
};

export function wardBoundaryFeature(wardId: number): WardBoundaryFeature | null {
  const { byId } = requireLoaded();

  const feature = byId.get(wardId);
  if (!feature) return null;

  return {
    type: 'Feature',
    properties: { id: feature.boundaryRef, wardId: feature.wardId },
    geometry: feature.geometry,
  };
}
