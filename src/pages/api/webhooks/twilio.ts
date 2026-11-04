/**
 * POST /api/webhooks/twilio — Twilio status/inbound-message webhook.
 *
 * Two things this endpoint does, both gated on a verified `X-Twilio-Signature`:
 *  - inbound opt-out keywords (STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT) on
 *    the WhatsApp `Body` -> permanent `whatsapp` suppression for the sender
 *    (dormant — architecture.md §15).
 *  - delivery-status callbacks (`MessageStatus`/`SmsStatus`) -> logged only,
 *    never a suppression write.
 *
 * AUTH: signature only, no session/CSRF (Task 53; middleware exempts
 * `/api/webhooks/*`, see src/middleware.ts). Twilio's request-signing
 * scheme: HMAC-SHA1, base64-encoded, keyed by `TWILIO_AUTH_TOKEN`, over the
 * exact public URL Twilio was configured to POST to, with every POST
 * param — sorted alphabetically by name — appended as `name` + `value`
 * (no separators) directly onto that URL string. Compared to the
 * `X-Twilio-Signature` header with `crypto.timingSafeEqual`.
 *
 * URL RECONSTRUCTION / DEPLOYMENT ASSUMPTION: Twilio signs the URL it was
 * literally configured with, so we must reconstruct that exact string
 * server-side. Behind nginx (Task 60, deploy/nginx/conf.d/site.conf sets
 * `proxy_set_header X-Forwarded-Proto https;` and a pinned `Host` on every
 * proxied location, including `/api/webhooks/`), we build
 * `${proto}://${host}${pathname}` from `X-Forwarded-Proto` (falling back to
 * `https`) and the `Host` header, plus `new URL(request.url).pathname` for
 * the path. THIS ONLY MATCHES IF THE TWILIO CONSOLE'S CONFIGURED WEBHOOK
 * URL IS EXACTLY `https://<host><pathname>` with NO query string — the Task
 * 60 nginx config and the Twilio console webhook URL must agree on this
 * (no trailing slash mismatch, no `?extra=params` appended in the console).
 * A missing/wrong `X-Forwarded-Proto` or `Host` at the nginx layer makes
 * EVERY Twilio webhook 403 here (signature verification would be computed
 * against the wrong URL) — see deploy/nginx/conf.d/site.conf's own comment
 * on the `/api/webhooks/` location.
 *
 * FAIL-CLOSED (security-critical): missing/empty `TWILIO_AUTH_TOKEN`,
 * missing `X-Twilio-Signature` header, a computed signature that doesn't
 * match (including a length mismatch, checked before `timingSafeEqual` so
 * it never throws), or `request.formData()`/reconstruction throwing (e.g.
 * Content-Type isn't `application/x-www-form-urlencoded` or valid
 * `multipart/form-data` — Node's `formData()` throws a TypeError for JSON
 * bodies, missing Content-Type, or malformed multipart) -> 403, nothing
 * written, never a 500.
 */
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { addSuppression } from '../../../lib/suppressions';
import { normalizeDestination } from '../../../lib/otp';
import { logEvent } from '../../../lib/log';

const SIGNATURE_HEADER = 'x-twilio-signature';

const NO_STORE = { 'cache-control': 'no-store' } as const;

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);

function forbidden(): Response {
  return new Response(null, { status: 403, headers: NO_STORE });
}

function ok(): Response {
  return new Response(null, { status: 200, headers: NO_STORE });
}

/** Reconstructs the public URL Twilio was configured with — see module docstring. */
function reconstructUrl(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  const host = request.headers.get('host') ?? '';
  const pathname = new URL(request.url).pathname;
  return `${proto}://${host}${pathname}`;
}

function expectedSignature(authToken: string, url: string, params: URLSearchParams): string {
  const sortedNames = [...params.keys()].sort();
  let signedString = url;
  for (const name of sortedNames) {
    signedString += name + (params.get(name) ?? '');
  }
  return crypto.createHmac('sha1', authToken).update(signedString, 'utf8').digest('base64');
}

function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(actual, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export const POST: APIRoute = async ({ request }) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signatureHeader = request.headers.get(SIGNATURE_HEADER);

  if (!authToken || !signatureHeader) {
    return forbidden();
  }

  let verified: boolean;
  let params: URLSearchParams;
  try {
    const formData = await request.formData();
    params = new URLSearchParams();
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') params.append(key, value);
    }

    const url = reconstructUrl(request);
    const expected = expectedSignature(authToken, url, params);
    verified = signaturesMatch(expected, signatureHeader);
  } catch {
    // Content-Type isn't parseable as form data (or reconstruction/signing
    // otherwise threw) -> fail closed, not a 500.
    verified = false;
    params = new URLSearchParams();
  }

  if (!verified) {
    return forbidden();
  }

  const body = params.get('Body');
  if (body !== null && STOP_KEYWORDS.has(body.trim().toUpperCase())) {
    const from = params.get('From') ?? '';
    const stripped = from.startsWith('whatsapp:') ? from.slice('whatsapp:'.length) : from;
    const normalized = normalizeDestination(stripped);
    if (normalized) {
      await addSuppression(normalized, 'whatsapp', 'stop');
    }
    // else: no `From` (or it normalized to empty) -> nothing to suppress;
    // intentional no-op, not an oversight. Still ack 200 so Twilio doesn't retry.
    return ok();
  }

  const status = params.get('MessageStatus') ?? params.get('SmsStatus');
  if (status !== null) {
    // PRIVACY: never log the contact — only the opaque delivery status.
    logEvent('whatsapp_delivery_status', { status });
    return ok();
  }

  return ok();
};
