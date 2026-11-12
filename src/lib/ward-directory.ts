/**
 * The ward directory (`/wards`, `/corporation/{slug}`): every ward grouped
 * Corporation → Zone → Ward. Built from the `wards` table only, never from
 * candidate data, so it is complete before any nomination is loaded.
 */
import { asc } from 'drizzle-orm';
import { db } from '../db/client';
import { wards } from '../db/schema';

type Corporation = (typeof wards.$inferSelect)['corporation'];

/** Corporation order follows the source data's `corporation_id` (1..5). */
export const CORPORATION_ORDER: readonly Corporation[] = ['central', 'north', 'east', 'south', 'west'];

export function isCorporation(slug: string | undefined): slug is Corporation {
  return CORPORATION_ORDER.some((corporation) => corporation === slug);
}

export interface DirectoryWard {
  id: number;
  nameEn: string;
  nameKn: string;
}

export interface DirectoryZone {
  zone: string;
  wards: DirectoryWard[];
}

export interface DirectoryCorporation {
  corporation: Corporation;
  zones: DirectoryZone[];
  wardCount: number;
}

/** All corporations (or just one), each with its zones and wards in ward-number order. */
export async function loadWardDirectory(only?: Corporation): Promise<DirectoryCorporation[]> {
  const rows = await db
    .select({ id: wards.id, nameEn: wards.nameEn, nameKn: wards.nameKn, corporation: wards.corporation, zone: wards.zone })
    .from(wards)
    .orderBy(asc(wards.id));

  const result: DirectoryCorporation[] = [];
  for (const corporation of CORPORATION_ORDER) {
    if (only && corporation !== only) continue;
    const zones = new Map<string, DirectoryWard[]>();
    for (const row of rows) {
      if (row.corporation !== corporation) continue;
      const list = zones.get(row.zone) ?? [];
      list.push({ id: row.id, nameEn: row.nameEn, nameKn: row.nameKn });
      zones.set(row.zone, list);
    }
    // Zones appear in the order of their first ward (the rows are id-ordered).
    const zoneList = [...zones].map(([zone, list]) => ({ zone, wards: list }));
    result.push({ corporation, zones: zoneList, wardCount: zoneList.reduce((sum, z) => sum + z.wards.length, 0) });
  }
  return result;
}
