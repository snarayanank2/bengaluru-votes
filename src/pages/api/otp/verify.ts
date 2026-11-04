/**
 * POST /api/otp/verify — completes the single OTP mechanism (dormant —
 * architecture.md §15). One flow handles both branches:
 *
 *  - KNOWN contact (a `users` row already has this email/phone) -> LOGIN:
 *    create a session, set the cookie, `{ok:true, registered:false}`.
 *  - UNKNOWN contact -> REGISTRATION: requires the `register` payload
 *    (wardId, language, futureTools). Missing -> `{ok:false,
 *    reason:'registration_required'}` so the client shows the confirm step
 *    and re-submits with it. Present -> creates the account, WITH THE
 *    CONSENT EVIDENCE required stored on the row itself:
 *    `consentAt` (now), `consentVersion` (`app_settings['consent_wording_version']`,
 *    falling back to a default if that setting is unset), `futureToolsOptIn`,
 *    and `srcAttribution` from the `bv_src` cookie if present.
 *    Registration *is* the consent act — there is no separate
 *    consent record; the wording shown at the confirm step includes the
 *    "I am 18 or older" assertion, captured implicitly by `consentVersion`.
 *
 * ONE ACCOUNT PER CONTACT, case-normalization, and the
 * peek-then-consume handling of the OTP code across the two-call
 * confirm/register step (Task 27) all live in `resolveOrRegister`
 * (src/lib/auth-flow.ts) — the SAME helper `/login`'s no-JS fallback
 * (src/lib/login-flow.ts) uses, so the two entry points can never diverge on
 * this security-critical logic.
 *
 * `no-store` always. The Set-Cookie this endpoint sends is `bv_session`
 * (src/lib/session.ts) and NOTHING ELSE.
 *
 * READING `bv_src` HERE IS SAFE: this is a `no-store` API POST route, not a
 * publicly cached anonymous GET page — the cache-safety invariant elsewhere
 * in this codebase (never read cookies on a page nginx might cache) doesn't
 * apply to `/api/*` routes.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { resolveOrRegister } from '../../../lib/auth-flow';

const registerSchema = z.object({
  wardId: z.number().int(),
  language: z.enum(['en', 'kn']),
  futureTools: z.boolean(),
});

const bodySchema = z.object({
  destination: z.string().trim().min(1),
  code: z.string().trim().min(1),
  register: registerSchema.optional(),
});

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' } as const;

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'destination and code are required' }, 400);
  }

  const { destination: destinationRaw, code, register } = parsed.data;
  const srcAttribution = cookies.get('bv_src')?.value ?? null;

  const result = await resolveOrRegister(destinationRaw, code, register, srcAttribution);
  if (!result.ok) {
    return json({ ok: false, reason: result.reason });
  }

  return json({ ok: true, registered: result.registered }, 200, { 'set-cookie': result.setCookie });
};
