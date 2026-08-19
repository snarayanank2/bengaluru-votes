/**
 * POST /api/booth-lookup — EPIC (voter ID) number -> the citizen's polling
 * booth, and the ward we know it by.
 *
 * INPUT MODE CHANGED 2026-08-19 (milestones.md §3, tracker 127). This
 * endpoint used to take a free-text address, geocode it to a ward, and read
 * booths out of the local `booths` table. That path is gone. It could not
 * work: the addressed polling-station rows were dropped from the plan on
 * 2026-08-15, nothing seeds `booths` outside `scripts/seed-dev.ts`, and the
 * empty-table branch therefore answered every real visitor with "we don't
 * have booth data yet" — a lookup that always fails, dressed as one that
 * might succeed. The EPIC path returns real data from the BBMP electoral
 * API instead (src/lib/electoral-api.ts).
 *
 * The `booths` table itself is left in the schema, unused, rather than
 * dropped in the same change.
 *
 * Resolution — including the ward mapping and its point-in-polygon fallback
 * — lives in `src/lib/booth-lookup.ts`, shared with the no-JS POST branch of
 * `src/features/pages/FindBooth.astro`. That module also logs the event, so
 * this file logs nothing: one call site, one log line, no chance of the two
 * paths reporting differently.
 *
 * PRIVACY. The response body carries the voter's name and EPIC, because the
 * citizen asked for their own record and needs to see it is theirs. Nothing
 * about it is logged, cached or stored (src/lib/electoral-api.ts's header
 * has the full rule). `cache-control: no-store` on every response, including
 * the 400s; no cookie is ever set.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { lookupBoothByEpic } from '../../lib/booth-lookup';

/**
 * Deliberately loose. EPIC formats vary (the common one is three letters and
 * seven digits, but older and state-specific series differ, and some carry
 * separators), so this rejects only what cannot be a voter ID at all —
 * anything with a length or a character set that shows the field was misused.
 * Case and internal spaces are normalized downstream, not rejected here.
 */
const bodySchema = z.object({
  epic: z
    .string()
    .trim()
    .min(4)
    .max(32)
    .regex(/^[A-Za-z0-9\s/-]+$/),
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
    return json({ error: 'a voter ID (EPIC) number is required' }, 400);
  }

  return json(await lookupBoothByEpic(parsed.data.epic));
};
