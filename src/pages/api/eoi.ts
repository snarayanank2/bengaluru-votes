/**
 * POST /api/eoi — the "partner with us" expression-of-interest form's front
 * door (information-architecture.md §3.15; PRD §5.13/§6.3; architecture.md
 * §7/§13). THE ONE ANONYMOUS WRITE PATH on this platform: no session, no
 * account, no per-user identity to rate-limit (src/lib/rate-limit.ts's
 * `eoi` case throws rather than pretend an account-keyed limit applies
 * here) — reCAPTCHA v3 (src/lib/recaptcha.ts) is the actual anti-bot gate,
 * and admin triage (`/admin/partners`, src/lib/partners.ts's `listEois`) is
 * the backstop: a spammed queue wastes admin time but touches no published
 * data.
 *
 * NOT a form route (no synchronizer CSRF token, unlike /account, /curator,
 * /admin) — like every other JSON `/api/*` endpoint it relies on
 * src/middleware.ts's Origin/Sec-Fetch-Site check (the anti-CSRF layer) PLUS
 * reCAPTCHA (the anti-bot layer) together. `/api/eoi` is NOT in the
 * `/api/webhooks/*` exemption, so a cross-site POST here still 403s at the
 * middleware before this handler ever runs.
 *
 * PRIVACY (architecture.md §13): `name`/`organisation`/`contact`/
 * `wardsText`/`message` are free text that may contain PII — never logged.
 * Only the resulting `path` (a fixed enum, not free text) and the row id
 * are logged.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { db } from '../../db/client';
import { eoiSubmissions } from '../../db/schema';
import { verifyRecaptcha } from '../../lib/recaptcha';
import { logEvent } from '../../lib/log';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Turns an empty/whitespace-only optional string into `null` — same convention as src/lib/partners.ts's `updatePartner`. */
function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const bodySchema = z.object({
  path: z.enum(['awareness', 'curation']),
  name: z.string().trim().min(1).max(200),
  organisation: z.string().trim().max(200).nullable().optional(),
  contact: z.string().trim().min(1).max(300),
  wardsText: z.string().trim().max(1000).nullable().optional(),
  message: z.string().trim().max(2000).nullable().optional(),
  // Present but NOT required to be non-empty: when RECAPTCHA_SITE_KEY isn't
  // configured (this repo's dev/CI env), the page's script never obtains a
  // real token and posts an empty string instead (PartnerWithUs.astro /
  // src/islands/EoiForm.ts) — src/lib/recaptcha.ts's own no-secret dev-accept
  // rule is what makes that submission still succeed in dev/CI. Production
  // always has both a site key (real token) and a secret (real
  // verification), so an empty token there fails verification for real.
  recaptchaToken: z.string(),
});

export const POST: APIRoute = async ({ request }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid eoi payload' }, 400);
  }

  const verified = await verifyRecaptcha(parsed.data.recaptchaToken, { expectedAction: 'eoi' });
  if (!verified.ok) {
    // PRIVACY: log the reCAPTCHA outcome only — never the submitted fields.
    logEvent('eoi_recaptcha_rejected', { reason: verified.reason });
    return json({ error: 'recaptcha_failed' }, 403);
  }

  const [row] = await db
    .insert(eoiSubmissions)
    .values({
      path: parsed.data.path,
      name: parsed.data.name,
      organisation: emptyToNull(parsed.data.organisation),
      contact: parsed.data.contact,
      wardsText: emptyToNull(parsed.data.wardsText),
      message: emptyToNull(parsed.data.message),
      status: 'new',
    })
    .returning({ id: eoiSubmissions.id });

  // PRIVACY: log only the path (a fixed enum) + the resulting id — never
  // name/organisation/contact/wardsText/message.
  logEvent('eoi_submitted', { path: parsed.data.path, eoiId: row!.id });

  return json({ ok: true, id: row!.id }, 200);
};
