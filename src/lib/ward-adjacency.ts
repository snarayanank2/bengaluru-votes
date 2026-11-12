/**
 * Which wards touch which, computed from the ward boundaries in
 * `data/gba.geojson` (architecture §4 "Ward page trail and neighbours"). Pure and
 * deterministic: the same GeoJSON always gives the same answer.
 *
 * This runs offline, never per request: `scripts/build-ward-neighbours.ts`
 * writes the result to `data/ward-neighbours.json`, and a test fails when
 * that file no longer matches the GeoJSON. Request code only reads the file
 * (`src/lib/ward-neighbours.ts`).
 *
 * Method: the ward polygons come from one clean topology, so two wards that
 * share a border share the same vertices along it. Every ring edge is keyed
 * by its two endpoints (rounded to 1e-6 degrees, about 0.1 m); an edge that
 * two wards both carry is shared boundary, and its length in metres is added
 * to that pair. Wards that meet only at a single point share no edge and are
 * not neighbours. Ranking: longest shared boundary first, ties by ward id.
 */

type Position = number[];
export interface WardFeature {
  properties: { corporation_id: number; ward_id: number };
  geometry: { type: 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] };
}

/** How many neighbours a ward page lists at most. */
export const MAX_NEIGHBOURS = 6;

const QUANTUM = 1e6;
const METRES_PER_DEGREE = 111_320;
// Bengaluru sits near 13 degrees north: a degree of longitude is this much shorter.
const LNG_SCALE = Math.cos((13 * Math.PI) / 180);

function ringsOf(geometry: WardFeature['geometry']): Position[][] {
  return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
}

export function computeWardNeighbours(features: WardFeature[], limit = MAX_NEIGHBOURS): Record<string, number[]> {
  const idOf = (f: WardFeature) => f.properties.corporation_id * 1000 + f.properties.ward_id;

  // edge key -> ward id -> edge length in metres
  const edges = new Map<string, Map<number, number>>();
  for (const feature of features) {
    const id = idOf(feature);
    for (const ring of ringsOf(feature.geometry)) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[i + 1];
        const a = `${Math.round(ax * QUANTUM)},${Math.round(ay * QUANTUM)}`;
        const b = `${Math.round(bx * QUANTUM)},${Math.round(by * QUANTUM)}`;
        if (a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const metres = Math.hypot((bx - ax) * LNG_SCALE, by - ay) * METRES_PER_DEGREE;
        let owners = edges.get(key);
        if (!owners) edges.set(key, (owners = new Map()));
        owners.set(id, metres);
      }
    }
  }

  const shared = new Map<number, Map<number, number>>();
  for (const owners of edges.values()) {
    if (owners.size < 2) continue;
    const ids = [...owners.keys()];
    for (const from of ids) {
      for (const to of ids) {
        if (from === to) continue;
        let row = shared.get(from);
        if (!row) shared.set(from, (row = new Map()));
        row.set(to, (row.get(to) ?? 0) + owners.get(from)!);
      }
    }
  }

  const result: Record<string, number[]> = {};
  for (const id of features.map(idOf).sort((x, y) => x - y)) {
    const ranked = [...(shared.get(id) ?? [])].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
    result[String(id)] = ranked.slice(0, limit).map(([neighbour]) => neighbour);
  }
  return result;
}
