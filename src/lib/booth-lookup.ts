/**
 * Polling-booth lookup by EPIC (voter ID) number — the resolution step
 * between the raw upstream record (`src/lib/electoral-api.ts`) and something
 * this platform can render.
 *
 * Two callers, one function, deliberately: `src/pages/api/booth-lookup.ts`
 * and the no-JS POST branch of `src/features/pages/FindBooth.astro` (and the
 * home page's booth card, which posts to the same page). The page imports
 * this directly and never fetches its own endpoint — the same convention
 * Home.astro follows with `lookupWardByAddress`.
 *
 * WHAT THIS ADDS over the upstream call:
 *
 *  1. **The ward.** Upstream names the voter's ward in its own vocabulary;
 *     `src/lib/electoral-wards.ts` turns that into one of our 369 `wards.id`
 *     values (read its header — the corporation ids are transposed between
 *     the two sources, and getting it wrong is silent). We then load OUR
 *     ward row and display OUR name for it, so a citizen who arrives here
 *     and a citizen who arrived through the address finder see the same
 *     ward called the same thing.
 *
 *  2. **A fallback that costs nothing.** If the name/number mapping misses —
 *     an unrecognized corporation, a reworded ward string — the polling
 *     station's own coordinates go through `lookupWardByPoint`, which is
 *     pure point-in-polygon against `data/gba.geojson`: no Google call, no
 *     geocode budget, nothing to exhaust. Verified against the live sample,
 *     both paths agree. If both miss, the booth still renders; only the ward
 *     link is dropped.
 *
 *  3. **A daily cap.** `consumeBudget('epic_lookup', …)` — the same counter
 *     mechanism as geocoding (src/lib/budgets.ts). Nothing here costs us
 *     money; the cap exists so a script pointed at this endpoint cannot use
 *     us to hammer a public government service. It is global, not per-IP,
 *     which means a determined abuser can deny the feature to everyone for
 *     the rest of the UTC day — the same trade the geocode budget already
 *     makes, and the reason the limit is set well above plausible citizen
 *     traffic rather than tight.
 *
 * PRIVACY (architecture §13). The voter's name and EPIC pass through this
 * module and are returned to the caller; they are never logged, cached or
 * stored. `logEvent` below gets the result kind and a ward id — nothing that
 * came out of the upstream record. Callers must send `cache-control:
 * no-store`. See src/lib/electoral-api.ts's header for the full rule.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { wards } from '../db/schema';
import { consumeBudget } from './budgets';
import { searchByEpic } from './electoral-api';
import { upstreamWardId } from './electoral-wards';
import { lookupWardByPoint } from './geocode';
import { logEvent } from './log';

/**
 * Politeness cap on calls to the upstream government API, per UTC day. Not a
 * spend limit — the endpoint is free and unauthenticated. Set high enough
 * that real citizen traffic never reaches it.
 */
export const EPIC_DAILY_BUDGET = Number(process.env.EPIC_DAILY_BUDGET ?? 5000);

/** The voter's own roll entry. Personal data — display only, never persisted. */
export interface BoothLookupVoter {
  epic: string;
  nameEn: string;
  nameKn: string;
}

/** Our ward, named our way. `null` when neither mapping path resolved one. */
export interface BoothLookupWard {
  id: number;
  nameEn: string;
  nameKn: string;
  corporation: string;
}

export interface BoothLookupBooth {
  nameEn: string;
  nameKn: string;
  /** The voter's serial number on that booth's roll — what officials ask for. */
  serialNo: number;
  lat: number;
  lng: number;
}

export type BoothLookupResult =
  | { result: 'booth'; voter: BoothLookupVoter; ward: BoothLookupWard | null; booth: BoothLookupBooth }
  | { result: 'not_found' }
  | { result: 'unavailable'; reason: 'timeout' | 'failed' | 'malformed' | 'budget' };

async function wardRow(id: number): Promise<BoothLookupWard | null> {
  const [row] = await db
    .select({
      id: wards.id,
      nameEn: wards.nameEn,
      nameKn: wards.nameKn,
      corporation: wards.corporation,
    })
    .from(wards)
    .where(eq(wards.id, id));
  return row ?? null;
}

/**
 * Resolve the upstream record's ward to one of ours: by (corporation name,
 * ward number) first, then by the polling station's coordinates. Returns
 * `null` rather than guessing.
 */
async function resolveWard(
  corporationName: string,
  wardName: string,
  psLat: number,
  psLng: number,
): Promise<BoothLookupWard | null> {
  const mapped = upstreamWardId(corporationName, wardName);
  if (mapped !== null) {
    const row = await wardRow(mapped);
    if (row) {
      return row;
    }
  }

  // Free, offline, and independent of anything upstream chose to call this
  // ward. Only reached when the mapping above could not place it.
  const byPoint = await lookupWardByPoint(psLat, psLng);
  return byPoint.kind === 'ward' ? wardRow(byPoint.wardId) : null;
}

/**
 * Look up a citizen's polling booth from their EPIC number. Never throws;
 * every failure is a result kind the UI renders as its own message.
 */
export async function lookupBoothByEpic(epic: string): Promise<BoothLookupResult> {
  const withinBudget = await consumeBudget('epic_lookup', EPIC_DAILY_BUDGET);
  if (!withinBudget) {
    logEvent('booth_lookup', { result: 'unavailable', reason: 'budget' });
    return { result: 'unavailable', reason: 'budget' };
  }

  const search = await searchByEpic(epic);

  if (search.kind === 'not_found') {
    logEvent('booth_lookup', { result: 'not_found' });
    return { result: 'not_found' };
  }

  if (search.kind === 'unavailable') {
    logEvent('booth_lookup', { result: 'unavailable', reason: search.reason });
    return { result: 'unavailable', reason: search.reason };
  }

  const { record } = search;
  const ward = await resolveWard(record.corporationName, record.wardName, record.psLat, record.psLng);

  // Ward id only. Never the epic, never the name — see the header.
  logEvent('booth_lookup', { result: 'booth', wardId: ward?.id ?? null });

  return {
    result: 'booth',
    voter: { epic: record.epic, nameEn: record.nameEn, nameKn: record.nameKn },
    ward,
    booth: {
      nameEn: record.psNameEn,
      nameKn: record.psNameKn,
      serialNo: record.psSerialNo,
      lat: record.psLat,
      lng: record.psLng,
    },
  };
}
