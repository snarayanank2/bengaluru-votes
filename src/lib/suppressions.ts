/**
 * The suppression list — a hard stop on sending to a given (contact,
 * channel) pair after a bounce, spam complaint, or a WhatsApp "STOP" reply
 * (dormant — architecture.md §15).
 * `src/lib/otp.ts` already reads this table directly for the auth flow;
 * this module is the shared read/write surface for the campaign send path
 * (`src/lib/send/send.ts`) and for Task 53's bounce/complaint webhooks,
 * which call `addSuppression`.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { suppressions } from '../db/schema';

export type SuppressionChannel = 'email' | 'whatsapp';
export type SuppressionReason = 'bounce' | 'complaint' | 'stop';

/** True iff `contact` is suppressed on `channel` — MUST be checked before every send on that channel. */
export async function isSuppressed(contact: string, channel: SuppressionChannel): Promise<boolean> {
  const rows = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.contact, contact), eq(suppressions.channel, channel)));
  return rows.length > 0;
}

/**
 * Records a suppression for (contact, channel). Idempotent on the
 * `(contact, channel)` unique index (`suppression_uq`) — calling this twice
 * for the same pair (e.g. a webhook redelivery, or a complaint arriving
 * after an earlier bounce) never throws; the second call just confirms the
 * latest `reason`.
 */
export async function addSuppression(
  contact: string,
  channel: SuppressionChannel,
  reason: SuppressionReason,
): Promise<void> {
  await db
    .insert(suppressions)
    .values({ contact, channel, reason })
    .onConflictDoUpdate({
      target: [suppressions.contact, suppressions.channel],
      set: { reason },
    });
}
