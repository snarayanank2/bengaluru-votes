/**
 * The campaign send path: given a user and a send code (W1..F1 —
 * architecture.md §7/§10, docs/prd.md §9.3), resolves which channels are
 * eligible, honours suppressions BEFORE every send, renders the message,
 * dispatches it (or logs a no-op under `SENDS_DISABLED`), and writes exactly
 * one `campaign_sends` row per (code, userId, channel) — the send-once
 * ledger enforced by `send_once_uq`.
 *
 * ORDERING PER CHANNEL (mirrors src/lib/otp.ts's cooldown ordering style —
 * cheapest/safest checks first):
 *   1. Channel eligibility — contact present AND the user's toggle is on
 *      (`emailEnabled`/`whatsappEnabled`, /account/notifications). A
 *      channel that fails this check is simply not attempted; it never
 *      appears in the returned `results` and no ledger row is written for
 *      it (there is nothing to record — the user opted the channel out
 *      entirely, distinct from "suppressed").
 *   2. Send-once — if a `campaign_sends` row already exists for
 *      (code, userId, channel), this is a re-run (e.g. a retried job): skip
 *      the send AND the insert, returning the existing row's status. This
 *      check exists so a re-run never even attempts the insert that
 *      `send_once_uq` would reject — the unique index is the backstop, not
 *      the primary mechanism.
 *   3. Suppression (architecture §7: "honoured before every send") — a
 *      bounce/complaint/STOP on this exact contact+channel. Recorded as its
 *      own ledger status (`'suppressed'`) rather than silently skipped, so
 *      the audit trail shows WHY a user didn't get a message they were
 *      otherwise eligible for.
 *   4. Render + send.
 *
 * SENDS_DISABLED (architecture.md §14.2, the local-stack guard): when
 * `process.env.SENDS_DISABLED === 'true'`, no transport is called at all —
 * this function logs the code/userId/channel and writes the ledger row as
 * `'sent'` anyway. This is a deliberate choice, not an oversight: the
 * send-once ledger's whole job is "never send the same code to the same
 * user twice", and that guarantee has to hold with sends disabled too —
 * a distinct "disabled" status would make every disabled run resend forever
 * once SENDS_DISABLED flips off. The disabled-ness is legible from the log
 * line, not from the ledger.
 *
 * PRIVACY (architecture.md §13): logged fields are code/userId/channel/
 * status ONLY — never the resolved contact (email/phone).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { campaignSends } from '../../db/schema';
import type { Lang } from '../../i18n';
import { logEvent } from '../log';
import { isSuppressed } from '../suppressions';
import { contentVariablesFor, renderEmailMarkdown, renderMessage, type Channel, type SendCode } from './render';
import { sendEmail } from './sendgrid';
import { sendWhatsAppTemplate } from './twilio';

export interface SendToUserUser {
  id: number;
  email: string | null;
  phone: string | null;
  language: Lang;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  homeWardId: number | null;
}

export type CampaignSendStatus = 'sent' | 'failed' | 'suppressed';

export interface ChannelResult {
  channel: Channel;
  status: CampaignSendStatus;
}

export interface SendToUserResult {
  results: ChannelResult[];
}

export interface SendToUserOpts {
  /** Overrides `user.homeWardId` for the ledger's `wardId` column (e.g. a curator-triggered resend scoped to a different ward). */
  wardId?: number;
}

/** Existing ledger row's status for (code, userId, channel), or undefined if none — the send-once check. */
async function existingSend(
  code: SendCode,
  userId: number,
  channel: Channel,
): Promise<CampaignSendStatus | undefined> {
  const [row] = await db
    .select({ status: campaignSends.status })
    .from(campaignSends)
    .where(and(eq(campaignSends.code, code), eq(campaignSends.userId, userId), eq(campaignSends.channel, channel)));
  // 'held' is a LEGACY status: the per-ward readiness gate that wrote it was
  // dropped on 2026-08-15 and nothing writes it any more. Treat anything
  // other than the three statuses this module writes as "not yet actually
  // sent", so a leftover held row never blocks a real send.
  if (row?.status === 'sent' || row?.status === 'failed' || row?.status === 'suppressed') {
    return row.status;
  }
  return undefined;
}

async function recordSend(
  code: SendCode,
  userId: number,
  wardId: number,
  channel: Channel,
  language: Lang,
  status: CampaignSendStatus,
): Promise<void> {
  // The pre-check in sendToUser (existingSend) is the primary send-once
  // mechanism; this insert is the backstop for a genuine concurrent race
  // (two callers both pass the pre-check before either inserts) AND the
  // held->terminal UPGRADE path: a leftover legacy 'held' row for
  // (code, userId, channel) — see existingSend above — is treated as "not
  // yet sent", so a real send still reaches this insert and replaces it.
  //
  // ON CONFLICT ... DO UPDATE ... WHERE status = 'held' (the `setWhere`
  // clause) means: if the existing row is 'held', overwrite it with this
  // real outcome (upgrading it to 'sent'/'failed'/'suppressed' exactly
  // once); if the existing row is already terminal ('sent'/'failed'/
  // 'suppressed' — i.e. NOT 'held'), the WHERE fails and Postgres leaves it
  // untouched, same as DO NOTHING. This preserves all three invariants:
  // (1) a terminal row is never overwritten (send-once holds), (2) the
  // concurrent-race backstop still degrades to a no-op, (3) a held row is
  // upgraded to terminal exactly once, so the NEXT run's existingSend sees
  // a terminal status instead of re-sending forever.
  await db
    .insert(campaignSends)
    .values({ code, userId, wardId, channel, language, status })
    .onConflictDoUpdate({
      target: [campaignSends.code, campaignSends.userId, campaignSends.channel],
      set: { status, wardId, language, sentAt: new Date() },
      setWhere: eq(campaignSends.status, 'held'),
    });
  logEvent('campaign_send', { code, userId, channel, status });
}

/**
 * Sends `code` to `user` across whichever channels are eligible (see module
 * docstring for the full per-channel ordering). `vars` are the named
 * template vars for `code` (see templates.ts) — the same record is used for
 * both channels' renders, so it must satisfy the union of both channels'
 * required vars.
 */
export async function sendToUser(
  user: SendToUserUser,
  code: SendCode,
  vars: Record<string, string>,
  opts?: SendToUserOpts,
): Promise<SendToUserResult> {
  const wardId = opts?.wardId ?? user.homeWardId ?? undefined;
  if (wardId === undefined) {
    throw new Error('sendToUser: no wardId available (pass opts.wardId or set user.homeWardId)');
  }

  const eligibleChannels: { channel: Channel; contact: string }[] = [];
  if (user.email && user.emailEnabled) eligibleChannels.push({ channel: 'email', contact: user.email });
  if (user.phone && user.whatsappEnabled) eligibleChannels.push({ channel: 'whatsapp', contact: user.phone });

  const results: ChannelResult[] = [];

  for (const { channel, contact } of eligibleChannels) {
    const already = await existingSend(code, user.id, channel);
    if (already !== undefined) {
      results.push({ channel, status: already });
      continue;
    }

    if (await isSuppressed(contact, channel)) {
      await recordSend(code, user.id, wardId, channel, user.language, 'suppressed');
      results.push({ channel, status: 'suppressed' });
      continue;
    }

    const rendered = renderMessage(code, user.language, channel, vars);

    let status: CampaignSendStatus;
    if (process.env.SENDS_DISABLED === 'true') {
      // No transport call — see module docstring "SENDS_DISABLED".
      logEvent('campaign_send_disabled', { code, userId: user.id, channel });
      status = 'sent';
    } else if (channel === 'email') {
      // rendered.body is Markdown (templates.ts's email bodies, verbatim
      // from docs/messages.md) — must be converted to HTML before it
      // reaches SendGrid's text/html content field, or recipients see
      // literal `**`/`[text](url)` (Task 52 review finding).
      const html = renderEmailMarkdown(rendered.body);
      const result = await sendEmail(contact, rendered.subject ?? '', html);
      status = result.ok ? 'sent' : 'failed';
    } else {
      const contentVars = contentVariablesFor(code, user.language, vars);
      const result = await sendWhatsAppTemplate(contact, rendered.templateSid!, contentVars);
      // WhatsApp not yet onboarded -> 'not_configured' is expected (PRD
      // §10/project-dependencies §3) and must NOT block the email channel
      // above, which is why this loop iterates independently per channel.
      status = result.ok && result.status === 'sent' ? 'sent' : 'failed';
    }

    await recordSend(code, user.id, wardId, channel, user.language, status);
    results.push({ channel, status });
  }

  return { results };
}
