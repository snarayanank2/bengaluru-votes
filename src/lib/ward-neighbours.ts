/**
 * Neighbouring wards for the ward page (architecture §4). The geometry is
 * done offline (`src/lib/ward-adjacency.ts`, `npm run build:ward-neighbours`)
 * and committed as `data/ward-neighbours.json`; a request only looks the ids
 * up here and then reads the matching `wards` rows. A ward missing from the
 * file (or with no neighbours) simply has none.
 */
import { inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { wards } from '../db/schema';
import neighbourIds from '../../data/ward-neighbours.json';

const NEIGHBOURS = neighbourIds as Record<string, number[]>;

export interface NeighbourWard {
  id: number;
  nameEn: string;
  nameKn: string;
  corporation: (typeof wards.$inferSelect)['corporation'];
}

/** The ward's neighbours, longest shared boundary first. */
export async function loadNeighbourWards(wardId: number): Promise<NeighbourWard[]> {
  const ids = NEIGHBOURS[String(wardId)] ?? [];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: wards.id, nameEn: wards.nameEn, nameKn: wards.nameKn, corporation: wards.corporation })
    .from(wards)
    .where(inArray(wards.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
