/**
 * POST /api/booth-lookup — address → voting booth(s) for the resolved ward
 * (PRD §5.10; architecture.md §7 endpoint table — "same shape[as ward-lookup],
 * booth data").
 *
 * Booth data is a separate dependency from ward boundaries (dependency
 * register §4) and may not be loaded yet even once wards/geocoding are
 * live. So the FIRST thing this handler does is check whether the
 * `booths` table is empty at all — BEFORE calling the geocoder — so an
 * empty table never implies "we tried to find your booth and failed"; it
 * honestly says "we don't have booth data yet" (PRD §5.10's guided
 * link-out state).
 *
 * Once booths exist, this reuses the same address→ward mechanism as
 * ward-lookup (src/lib/geocode.ts). Booth `lat`/`lng` in the response ARE
 * ours — official EC data seeded into `booths`, not Google's — so
 * returning them is NOT the Maps ToS constraint that forbids returning
 * Google's own geocoded coordinates (see the notice atop geocode.ts); only
 * the geocoder's own output must never carry a coordinate.
 *
 * A degradation kind that isn't `out_of_coverage` maps to
 * `{result:'unavailable', reason}`. Ward lookup uses the same vocabulary
 * since pincode was removed 2026-08-14 (src/pages/api/ward-lookup.ts).
 *
 * Always `cache-control: no-store`, never sets a cookie. PRIVACY: the raw
 * address is never passed to logEvent.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { booths } from '../../db/schema';
import { lookupWardByAddress } from '../../lib/geocode';
import { logEvent } from '../../lib/log';

const bodySchema = z.object({
  address: z.string().trim().min(1),
});

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
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
    return json({ error: 'address is required' }, 400);
  }

  // Check FIRST, before geocoding, so we never imply we tried and failed —
  // this is the guided link-out state (PRD §5.10).
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(booths);
  if (total === 0) {
    logEvent('booth_lookup', { result: 'no_booth_data' });
    return json({ result: 'no_booth_data' });
  }

  const lookup = await lookupWardByAddress(parsed.data.address);

  switch (lookup.kind) {
    case 'ward': {
      const rows = await db.select().from(booths).where(eq(booths.wardId, lookup.wardId));
      if (rows.length === 0) {
        // Booths exist elsewhere but not (yet) for this specific ward —
        // same honest "no data for you yet" answer, scoped to the ward.
        logEvent('booth_lookup', { result: 'no_booth_data', wardId: lookup.wardId });
        return json({ result: 'no_booth_data' });
      }
      logEvent('booth_lookup', { result: 'booth', wardId: lookup.wardId, count: rows.length });
      return json({
        result: 'booth',
        booths: rows.map((b) => ({
          id: b.id,
          nameEn: b.nameEn,
          nameKn: b.nameKn,
          address: b.address,
          lat: b.lat,
          lng: b.lng,
          wardId: b.wardId,
        })),
      });
    }
    case 'out_of_coverage':
      logEvent('booth_lookup', { result: 'out_of_coverage' });
      return json({ result: 'out_of_coverage' });
    case 'ambiguous':
      logEvent('booth_lookup', { result: 'unavailable', reason: 'ambiguous' });
      return json({ result: 'unavailable', reason: 'ambiguous' });
    case 'budget_exhausted':
      logEvent('booth_lookup', { result: 'unavailable', reason: 'budget' });
      return json({ result: 'unavailable', reason: 'budget' });
    case 'failed':
      logEvent('booth_lookup', { result: 'unavailable', reason: 'failed' });
      return json({ result: 'unavailable', reason: 'failed' });
  }
};
