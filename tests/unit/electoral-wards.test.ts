/**
 * The (corporation name, ward number) -> `wards.id` mapping that bridges the
 * BBMP electoral API's ward vocabulary to ours (src/lib/electoral-wards.ts).
 *
 * The fixture (tests/fixtures/electoral-api-wards.json) is the upstream ward
 * list as served by `GET /wards/{corp_id}` for all five corporations,
 * captured 2026-08-19. It carries no personal data — it is the published
 * ward list, nothing more.
 *
 * The load-bearing case is the corporation-id swap. Upstream numbers its
 * corporations East=4 / South=3; `data/gba.geojson` — and therefore
 * `wards.id`, which is `corporation_id * 1000 + ward_id` — numbers them
 * East=3 / South=4. Mapping through the upstream integer id would resolve
 * every East voter to a South ward and vice versa, silently and with a
 * plausible-looking ward page at the end of it. Hence: map by NAME.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { upstreamWardId, UPSTREAM_CORPORATION_IDS } from '../../src/lib/electoral-wards';

interface UpstreamWard {
  corp_id: number;
  corp_name: string;
  ward_id: number;
  ward_name: string;
  ward_name_l1: string;
}

interface GeoFeature {
  properties: { Corporation: string; corporation_id: number; ward_id: number; ward_name: string };
}

const upstream: UpstreamWard[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/electoral-api-wards.json', import.meta.url)), 'utf8'),
);

const geojson: { features: GeoFeature[] } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../data/gba.geojson', import.meta.url)), 'utf8'),
);

/** (corporation name, ward number) -> our ward id, straight from the source data. */
const ours = new Map<string, number>();
for (const f of geojson.features) {
  const p = f.properties;
  ours.set(`${p.Corporation}/${p.ward_id}`, p.corporation_id * 1000 + p.ward_id);
}

describe('upstreamWardId', () => {
  it('maps every one of the 369 upstream wards to the matching ward id', () => {
    expect(upstream).toHaveLength(369);
    expect(ours.size).toBe(369);

    const wrong: string[] = [];
    for (const row of upstream) {
      const expected = ours.get(`${row.corp_name}/${row.ward_id}`);
      const actual = upstreamWardId(row.corp_name, row.ward_name);
      if (actual !== expected) {
        wrong.push(`${row.corp_name} ${row.ward_name}: got ${actual}, want ${expected}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('produces 369 distinct ward ids — no two upstream wards collide', () => {
    const ids = upstream.map((r) => upstreamWardId(r.corp_name, r.ward_name));
    expect(new Set(ids).size).toBe(369);
    expect(ids).not.toContain(null);
  });

  // The regression this whole module exists for. Upstream East is corp_id 4;
  // ours is 3. A mapping that trusted the upstream integer would put this
  // voter in South.
  it('resolves East by name, not by the upstream corporation id', () => {
    expect(UPSTREAM_CORPORATION_IDS.east).toBe(3);
    expect(UPSTREAM_CORPORATION_IDS.south).toBe(4);
    // East 49 — the real sample from the API probe.
    expect(upstreamWardId('East', '49 - Doddakannelli Ward')).toBe(3049);
    // ...and the South ward that the upstream id would have wrongly selected.
    expect(upstreamWardId('South', '49 - Konanakunte')).toBe(4049);
  });

  // Upstream calls East 49 "Doddakannelli Ward"; gba.geojson calls it
  // "Shivanasamudra Ward". We key on the number, never the name text, so the
  // disagreement costs nothing.
  it('ignores the ward name text entirely, keying only on the leading number', () => {
    expect(upstreamWardId('East', '49 - Doddakannelli Ward')).toBe(3049);
    expect(upstreamWardId('East', '49 - Shivanasamudra Ward')).toBe(3049);
    expect(upstreamWardId('East', '49 - anything at all')).toBe(3049);
  });

  it('accepts the corporation name in any case, with surrounding space', () => {
    expect(upstreamWardId('east', '49 - X')).toBe(3049);
    expect(upstreamWardId('  East  ', '49 - X')).toBe(3049);
    expect(upstreamWardId('EAST', '49 - X')).toBe(3049);
  });

  it('returns null for an unknown corporation', () => {
    expect(upstreamWardId('Yelahanka', '1 - X')).toBeNull();
    expect(upstreamWardId('', '1 - X')).toBeNull();
  });

  it('returns null when no leading ward number can be read', () => {
    expect(upstreamWardId('East', 'Doddakannelli Ward')).toBeNull();
    expect(upstreamWardId('East', '')).toBeNull();
    expect(upstreamWardId('East', '- 49')).toBeNull();
  });

  // The composite key is corporation_id * 1000 + ward_id (scripts/seed-wards.ts).
  // A ward number at or above 1000 would collide into the next corporation.
  it('refuses a ward number that would break the composite key', () => {
    expect(upstreamWardId('East', '1000 - X')).toBeNull();
    expect(upstreamWardId('East', '0 - X')).toBeNull();
  });
});
