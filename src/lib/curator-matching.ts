/**
 * The curator's side of matching: confirming who a waiting affidavit
 * belongs to and which ward they are contesting. The work is
 * `confirmMatch` (src/lib/affidavit-queue.ts), shared with
 * `/admin/affidavits`; this module turns a posted form into that call and
 * its refusals into sentences. Upload, retry and discard are not here:
 * they are the admin's.
 */
import { confirmMatch, type AdminActionError } from './affidavit-queue';
import type { StaffActor } from './curator-fix';

export type MatchOutcome = { kind: 'matched' } | { kind: 'gone' } | { kind: 'refused'; key: string };

const ERROR_KEYS: Partial<Record<AdminActionError, string>> = {
  unknown_ward: 'admin.affidavits.error.unknownWard',
  name_required: 'admin.affidavits.error.nameRequired',
  party_required: 'admin.affidavits.error.partyRequired',
  unknown_candidate: 'admin.affidavits.error.unknownCandidate',
};

/** `confirmMatch` writes the `affidavit_matched` event itself, so nothing is logged here. */
export async function handleMatchConfirm(actor: StaffActor, id: number, form: FormData): Promise<MatchOutcome> {
  if (form.get('confirmPublish') == null) return { kind: 'refused', key: 'curator.fix.error.confirmRequired' };
  const attachRaw = String(form.get('attachToCandidateId') ?? '').trim();
  try {
    await confirmMatch(actor, id, {
      wardId: Number(String(form.get('wardId') ?? '').trim() || NaN),
      name: String(form.get('name') ?? ''),
      party: String(form.get('party') ?? ''),
      attachToCandidateId: attachRaw === '' ? undefined : Number(attachRaw),
    });
  } catch (err) {
    const code = (err instanceof Error ? err.message : '') as AdminActionError;
    // Someone else confirmed it between this page loading and this save.
    if (code === 'not_waiting') return { kind: 'gone' };
    const key = ERROR_KEYS[code];
    if (!key) throw err;
    return { kind: 'refused', key };
  }
  return { kind: 'matched' };
}
