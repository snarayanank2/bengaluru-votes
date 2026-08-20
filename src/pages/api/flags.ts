/**
 * POST /api/flags — the citizen misinformation-flagging path's front door
 * (PRD §6.1-§6.3; architecture §7 "POST /api/flags gated write, dedupe,
 * moderation; sourceUrl http(s)-validated §13").
 *
 * Session-gated: flagging (unlike anonymous read paths) requires an
 * identity so the dedupe/count and the per-account rate limit both mean
 * something — anonymous tap opens the Register/Login modal and resumes
 * here afterwards (PRD's core-concept #2), this route itself only ever
 * sees an authenticated request.
 *
 * `sourceUrl`, when present, MUST be an http(s) URL (architecture §13 —
 * kills `javascript:`/`data:`/etc. links from ever being stored and later
 * rendered as a clickable source).
 *
 * Rate-limited per `src/lib/rate-limit.ts`'s default flag budget
 * (10/day) — over budget gets 429, not a queued/degraded 200.
 *
 * PRIVACY: never logs `detail`/`sourceUrl` (free-text, may contain PII) —
 * only the resulting `flagItemId`.
 *
 * Not a form route (no synchronizer CSRF token) — like every other
 * `/api/*` JSON endpoint, it relies on the middleware's Origin/
 * Sec-Fetch-Site check plus the session cookie (src/middleware.ts).
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { submitFlag, InvalidFlagTargetError } from '../../lib/flags';
import { checkDefaultLimit } from '../../lib/rate-limit';
import { logEvent } from '../../lib/log';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** True iff `value` parses as an absolute http: or https: URL. Rejects javascript:, data:, mailto:, relative paths, etc. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const bodySchema = z.object({
  wardId: z.number().int().positive(),
  targetType: z.enum(['candidate_field', 'ward_field', 'ward_issue']),
  targetRef: z.string().trim().min(1),
  detail: z.string().trim().min(1),
  suggestedValue: z.string().trim().min(1).nullable().optional(),
  sourceUrl: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .optional()
    .refine((value) => value == null || isHttpUrl(value), {
      message: 'sourceUrl must be an http(s) URL',
    }),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.session;
  if (!session) {
    return json({ error: 'authentication required' }, 401);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid flag payload' }, 400);
  }

  const underLimit = await checkDefaultLimit(session.userId, 'flag');
  if (!underLimit) {
    return json({ error: 'rate limit exceeded' }, 429);
  }

  let flagItemId: number;
  try {
    ({ flagItemId } = await submitFlag(session.userId, parsed.data));
  } catch (err) {
    // A malformed targetRef or a target that doesn't exist — the ward is
    // DERIVED from the target server-side (never the client `wardId`), so a
    // target we can't resolve is a bad request, not a filed flag.
    if (err instanceof InvalidFlagTargetError) {
      return json({ error: 'invalid flag target' }, 400);
    }
    throw err;
  }

  // PRIVACY: log only the resulting id — never `detail`/`sourceUrl`
  // (free-text the citizen wrote, may contain PII).
  logEvent('flag_submitted', { flagItemId });

  return json({ ok: true, flagItemId });
};
