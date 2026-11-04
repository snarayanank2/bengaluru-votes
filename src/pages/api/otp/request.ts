/**
 * POST /api/otp/request — start of the single OTP mechanism for all roles
 * (dormant — architecture.md §15).
 *
 * NON-DISCLOSURE (binding): this endpoint NEVER reveals whether
 * `destination` belongs to a known account or a fresh one — the
 * Register/Login popup is one flow, and `requestOtp` itself never
 * queries `users`, so the response shape for a known login and a brand-new
 * registration is byte-for-byte identical. The only thing that varies the
 * response is per-destination cooldown/budget/suppression state, which by
 * design an outside prober can also trigger against a destination they
 * don't own — that's the accepted targeted-DoS trade documented in
 * src/lib/otp.ts, not a contact-existence leak.
 *
 * `no-store` always; never sets a cookie (this is the un-authenticated
 * first step of the flow — src/pages/api/otp/verify.ts is where a session
 * gets issued).
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requestOtp } from '../../../lib/otp';

const bodySchema = z.object({
  destination: z.string().trim().min(1),
  channel: z.enum(['email', 'whatsapp']).default('email'),
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
    return json({ error: 'destination is required' }, 400);
  }

  const { destination, channel } = parsed.data;
  const status = await requestOtp(destination, channel, 'auth');

  return json({ status });
};
