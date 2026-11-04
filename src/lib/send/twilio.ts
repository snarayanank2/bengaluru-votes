/**
 * Minimal Twilio WhatsApp Business API template-message wrapper — the
 * WhatsApp OTP transport behind src/lib/otp.ts (dormant —
 * architecture.md §15).
 *
 * EXPECTED STATE FOR ALL OF PHASE 0/1: WhatsApp is not onboarded yet — no
 * Twilio credentials, no approved Authentication-category template (
 * "Sending an OTP over WhatsApp requires completed Meta onboarding and
 * an approved template ... until that path completes ... login is
 * email-OTP only"). `not_configured` is therefore the normal return value
 * today, not a failure condition — this function returns it cleanly rather
 * than throwing, so src/lib/otp.ts can tell a caller "use email" instead of
 * surfacing a 500.
 */

const TWILIO_ENDPOINT_BASE = 'https://api.twilio.com/2010-04-01/Accounts';

/**
 * Sends one approved WhatsApp template message via Twilio.
 * `templateSid` is the approved Content API template SID; `vars` are its
 * named/positional content variables (e.g. `{ '1': code }` — Twilio's
 * ContentVariables convention).
 */
export async function sendWhatsAppTemplate(
  to: string,
  templateSid: string,
  vars: Record<string, string>,
): Promise<{ ok: boolean; status: 'sent' | 'not_configured' | 'failed' }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromWhatsApp = process.env.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !fromWhatsApp) {
    return { ok: false, status: 'not_configured' };
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const body = new URLSearchParams({
      To: `whatsapp:${to}`,
      From: `whatsapp:${fromWhatsApp}`,
      ContentSid: templateSid,
      ContentVariables: JSON.stringify(vars),
    });

    const res = await fetch(`${TWILIO_ENDPOINT_BASE}/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    return res.ok ? { ok: true, status: 'sent' } : { ok: false, status: 'failed' };
  } catch {
    return { ok: false, status: 'failed' };
  }
}
