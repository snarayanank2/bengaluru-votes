/**
 * The committed neighbour table (data/ward-neighbours.json) must match what
 * data/gba.geojson produces, so a boundary change cannot leave ward pages
 * linking to stale neighbours. Regenerate with `npm run build:ward-neighbours`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeWardNeighbours, MAX_NEIGHBOURS } from '../../src/lib/ward-adjacency';

const geojson = JSON.parse(readFileSync('data/gba.geojson', 'utf8'));
const committed: Record<string, number[]> = JSON.parse(readFileSync('data/ward-neighbours.json', 'utf8'));

describe('ward neighbours', () => {
  it('data/ward-neighbours.json is in step with data/gba.geojson', () => {
    expect(computeWardNeighbours(geojson.features)).toEqual(committed);
  });

  it('covers all 369 wards, each with real, distinct neighbours and never itself', () => {
    const ids = new Set(Object.keys(committed).map(Number));
    expect(ids.size).toBe(369);
    for (const [id, list] of Object.entries(committed)) {
      expect(list.length, `ward ${id}`).toBeGreaterThanOrEqual(1);
      expect(list.length, `ward ${id}`).toBeLessThanOrEqual(MAX_NEIGHBOURS);
      expect(new Set(list).size).toBe(list.length);
      expect(list).not.toContain(Number(id));
      for (const neighbour of list) expect(ids.has(neighbour), `${id} -> ${neighbour}`).toBe(true);
    }
  });

  it('ranks by shared boundary length and ignores wards that only touch at a corner', () => {
    const rect = (ward: number, x: number, y: number, w: number, h: number) => ({
      properties: { corporation_id: 1, ward_id: ward },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]],
      },
    });
    // Ward 1 is 2 wide: ward 3 sits on its whole top edge (length 2), ward 2 beside it
    // shares a side (length 1), ward 4 touches it only at the corner (2, 1).
    const result = computeWardNeighbours([rect(1, 0, 0, 2, 1), rect(2, 2, 0, 1, 1), rect(3, 0, 1, 2, 1), rect(4, 2, 1, 1, 1)]);
    expect(result['1001']).toEqual([1003, 1002]);
    expect(result["1004"]).toEqual([1003, 1002]); // the vertical side is longer once degrees of longitude are scaled to metres
  });
});
