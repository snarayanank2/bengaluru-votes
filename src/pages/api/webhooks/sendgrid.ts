/**
 * POST /api/webhooks/sendgrid — SendGrid Event Webhook (signed events).
 *
 * Writes `bounce`/`spamreport` events to the suppression list
 * (`src/lib/suppressions.ts`) so `src/lib/otp.ts`/the campaign send path
 * (dormant — architecture.md §15) never
 * sends to a contact that has already bounced or complained.
 *
 * AUTH: signature only — this route carries no session/CSRF (Task 53;
 * middleware exempts `/api/webhooks/*` from the Origin/Sec-Fetch-Site and
 * CSRF checks, see src/middleware.ts). Verification uses SendGrid's ECDSA
 * (P-256 / prime256v1) signed-event scheme:
 *   - headers: `X-Twilio-Email-Event-Webhook-Signature` (base64 signature),
 *     `X-Twilio-Email-Event-Webhook-Timestamp` (string timestamp). Yes,
 *     SendGrid's own header names carry the `X-Twilio-Email-...` prefix —
 *     that's correct, not a copy/paste typo (SendGrid is a Twilio product).
 *   - signed message = `timestamp + rawRequestBody` (string concat, over
 *     the EXACT raw bytes received — never a re-serialized JSON.stringify
 *     of the parsed body, which is not guaranteed byte-identical).
 *   - public key: `SENDGRID_WEBHOOK_PUBLIC_KEY`, a base64-encoded DER
 *     (SPKI) EC public key, PEM-wrapped here before verifying.
 *
 * FAIL-CLOSED (security-critical — a wrong signature check means accepting
 * forged bounce/complaint events, which an attacker could use to silently
 * suppress delivery to any address): missing/empty
 * `SENDGRID_WEBHOOK_PUBLIC_KEY`, either header missing, `verify()` false,
 * or `verify()`/key-parsing throwing (malformed key or signature) -> 403,
 * nothing written. Vendors retry on non-2xx, so a genuine SendGrid event
 * that transiently fails to verify will be retried — that's an acceptable
 * cost next to accepting a forged one.
 *
 * Non-suppression events (delivered/open/dropped/etc.) are no-ops -> 200
 * (vendors treat any non-2xx as "retry"; a no-op event must still 200 so
 * SendGrid doesn't hammer this endpoint retrying something we're
 * intentionally ignoring).
 */
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { addSuppression } from '../../../lib/suppressions';
import { logEvent } from '../../../lib/log';

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

const NO_STORE = { 'cache-control': 'no-store' } as const;

function forbidden(): Response {
  return new Response(null, { status: 403, headers: NO_STORE });
}

function derToPem(base64Der: string): string {
  const lines = base64Der.match(/.{1,64}/g) ?? [base64Der];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

interface SendGridEvent {
  event?: string;
  email?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const publicKeyB64 = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
  const signature = request.headers.get(SIGNATURE_HEADER);
  const timestamp = request.headers.get(TIMESTAMP_HEADER);

  if (!publicKeyB64 || !signature || !timestamp) {
    return forbidden();
  }

  // MUST verify against the raw bytes received — read as text before any parsing.
  const rawBody = await request.text();

  let verified: boolean;
  try {
    const pem = derToPem(publicKeyB64);
    const verify = crypto.createVerify('sha256');
    verify.update(timestamp + rawBody);
    verify.end();
    verified = verify.verify(pem, signature, 'base64');
  } catch {
    // Malformed key or signature -> fail closed, not a 500.
    verified = false;
  }

  if (!verified) {
    return forbidden();
  }

  let events: unknown;
  try {
    events = JSON.parse(rawBody);
  } catch {
    // Signature was valid but the body isn't valid JSON — nothing to do.
    return new Response(null, { status: 200, headers: NO_STORE });
  }

  if (Array.isArray(events)) {
    for (const raw of events as SendGridEvent[]) {
      if (!raw || typeof raw !== 'object') continue;
      const { event, email } = raw;
      if (event === 'bounce' && typeof email === 'string' && email) {
        await addSuppression(email, 'email', 'bounce');
      } else if (event === 'spamreport' && typeof email === 'string' && email) {
        await addSuppression(email, 'email', 'complaint');
      } else {
        // PRIVACY: never log the email address, only the opaque event type.
        logEvent('sendgrid_event', { event: event ?? 'unknown' });
      }
    }
  }

  return new Response(null, { status: 200, headers: NO_STORE });
};
