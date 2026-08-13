/**
 * Minimal SendGrid v3 `mail/send` wrapper — the OTP-email transport behind
 * src/lib/otp.ts (architecture.md §7 API surface: "Email OTP (SendGrid)").
 *
 * DEV/TEST POSTURE: until `SENDGRID_API_KEY` is set (never checked into the
 * repo — architecture §13 "Secrets": one `.env` outside the repo holding
 * vendor keys), `sendEmail` is a no-op stub — it logs one fixed line and
 * returns `{ok:true}`, so the OTP flow and its tests never need a live
 * SendGrid account or network access. This is the expected local/CI/dev
 * state, not a degraded fallback.
 *
 * PRIVACY (architecture.md §13, "Logs & telemetry carry IDs, not
 * identities"): the stub log line NEVER includes `to` — only the fact that
 * a send would have happened. Do not "helpfully" add the address to the
 * log line below.
 */
import { logEvent } from '../log';

const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';

/** Overridable for deploys that want a different verified sender; a safe placeholder otherwise. */
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL ?? 'no-reply@bengaluruvotes.opencity.in';

/**
 * Sends one HTML email via SendGrid. Returns `{ok:false}` on any non-2xx
 * response or network/transport error — this function never throws, so
 * callers (src/lib/otp.ts) can treat "send failed" as an ordinary result to
 * branch on rather than an exception to catch.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean }> {
  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    // PRIVACY: never log `to` (see module docstring).
    logEvent('sendgrid_dev_stub', { message: 'would send email to <opaque>' });
    return { ok: true };
  }

  try {
    const res = await fetch(SENDGRID_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM_EMAIL },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
