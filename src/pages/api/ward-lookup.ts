/**
 * POST /api/ward-lookup — address or position → single ward (PRD §5.1;
 * architecture.md §7 endpoint table, §11 degradation).
 *
 * TWO input modes, both resolved via src/lib/geocode.ts:
 *  - `{ address }`  — Google geocode, cached, budget-guarded, then
 *                     point-in-polygon.
 *  - `{ lat, lng }` — the browser already knows where the citizen is, so
 *                     this goes straight to point-in-polygon. No API call,
 *                     no budget spend, no cache row. Added 2026-08-14 for
 *                     the home page's "use my current location" control.
 *
 * The modes fail independently, which is the point: the coordinate mode
 * calls nothing, so it is the only path that still answers when geocoding
 * is `unavailable`. "Out of coverage" is a normal 200 answer, not an error
 * (PRD §5.1), and this endpoint never 500s just because Google or the
 * budget misbehaved.
 *
 * PINCODE LOOKUP WAS REMOVED 2026-08-14 — do not reintroduce it without
 * reading this. It existed as the low-cost hedge for the case where the
 * geocoder could not answer, and it returned a SHORTLIST of wards to choose
 * from. It was backed by `data/pincode-wards.json`, which never advanced
 * past a 12-row placeholder, so in practice `use_pincode` told citizens to
 * try something that could not work — worse than an honest error. With
 * Places Autocomplete on the input (src/islands/WardLookup.ts), ambiguous
 * addresses are also far rarer than they were.
 *
 * THE CONSEQUENCE, STATED PLAINLY: geocoding is the ONLY way to get from a
 * typed address to a ward. There is no address fallback and no browsable
 * ward list. When the daily geocode budget is exhausted
 * (GEOCODE_DAILY_BUDGET, default 2000 — deliberately left at that value) or
 * Google is unreachable, that mode is down and `unavailable` below is what
 * the citizen sees. That trade was made knowingly; if it ever bites, the fix
 * is to raise the budget or to build a real fallback, not to resurrect a
 * placeholder table.
 *
 * The coordinate mode is the one genuine hedge against that state — it
 * reaches a ward without Google — but it is not a general fallback: it needs
 * JS, a device that can produce a position, and the citizen's permission.
 *
 * Result kinds, deliberately sharing booth-lookup's vocabulary:
 *  - `ward`            — resolved
 *  - `out_of_coverage` — a real place, outside every GBA ward polygon
 *  - `ambiguous`       — Google matched more than one place, or flagged a
 *                        partial match; the citizen should be more specific.
 *                        Address mode only — a position is never ambiguous
 *  - `unavailable`     — budget exhausted, Google failed, or a resolved
 *                        ward id is missing from the DB. Not the citizen's
 *                        fault and not fixable by rewording, so it must not
 *                        be phrased as "we couldn't find that address"
 *
 * Always `cache-control: no-store` (per-citizen lookup, not cacheable) and
 * never sets a cookie — this is a public, unauthenticated endpoint and
 * must not become a cache-key or session hazard.
 *
 * PRIVACY: neither the raw address nor the citizen's coordinates are ever
 * passed to logEvent — only the result kind and which mode was used (see
 * src/lib/log.ts). The position is additionally never persisted anywhere;
 * see lookupWardByPoint in src/lib/geocode.ts.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { wards } from '../../db/schema';
import { lookupWardByAddress, lookupWardByPoint, type WardLookupResult } from '../../lib/geocode';
import { logEvent } from '../../lib/log';

const addressSchema = z.object({
  address: z.string().trim().min(1),
});

/**
 * The device-reported position from "use my current location". Range checks
 * only: a merely distant point is a normal `out_of_coverage` answer, while
 * an impossible one is a malformed request.
 */
const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

// Address first, so a body carrying both resolves deterministically (no
// client sends both; this just keeps it from being an accident).
const bodySchema = z.union([addressSchema, pointSchema]);

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

type WardRow = { id: number; nameEn: string; nameKn: string; corporation: string };

function wardPayload(row: WardRow) {
  return { id: row.id, nameEn: row.nameEn, nameKn: row.nameKn, corporation: row.corporation };
}

export const POST: APIRoute = async ({ request }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'provide an address or a position' }, 400);
  }

  const body = parsed.data;

  // `mode` is the only thing about the input that reaches the log: which of
  // the two paths the citizen used, never what they typed or where they are.
  const mode = 'address' in body ? 'address' : 'coords';

  const lookup: WardLookupResult =
    'address' in body
      ? await lookupWardByAddress(body.address)
      : await lookupWardByPoint(body.lat, body.lng);

  switch (lookup.kind) {
    case 'ward': {
      const [row] = await db.select().from(wards).where(eq(wards.id, lookup.wardId));
      if (!row) {
        // Data-integrity mismatch (a ward id the lookup resolved to isn't
        // seeded). To the citizen this is an outage, not a bad address —
        // so `unavailable`, not `ambiguous`, and never a 500.
        logEvent('ward_lookup', {
          result: 'error',
          reason: 'ward_not_in_db',
          mode,
          wardId: lookup.wardId,
        });
        return json({ result: 'unavailable', reason: 'failed' });
      }
      logEvent('ward_lookup', { result: 'ward', mode, wardId: row.id });
      return json({ result: 'ward', ward: wardPayload(row) });
    }
    case 'out_of_coverage':
      logEvent('ward_lookup', { result: 'out_of_coverage', mode });
      return json({ result: 'out_of_coverage' });

    // The citizen CAN act on this one — a more specific address helps.
    // Address branch only: a position is never ambiguous.
    case 'ambiguous':
      logEvent('ward_lookup', { result: 'ambiguous', mode });
      return json({ result: 'ambiguous' });

    // These two are ours, not theirs. Rewording the address will not help,
    // so they must never be phrased as "we couldn't find that address".
    // `reason` is kept for logs and for a future differentiated message; the
    // citizen-facing copy is the same for both today. Address branch only —
    // the coordinate path calls nothing and counts nothing, so it cannot
    // reach either, which is exactly why it still answers during an outage.
    case 'budget_exhausted':
      logEvent('ward_lookup', { result: 'unavailable', reason: 'budget', mode });
      return json({ result: 'unavailable', reason: 'budget' });
    case 'failed':
      logEvent('ward_lookup', { result: 'unavailable', reason: 'failed', mode });
      return json({ result: 'unavailable', reason: 'failed' });
  }
};
