/**
 * The affidavit extraction queue.
 *
 * `candidate_affidavits` IS the queue: an uploaded PDF starts `queued`, a
 * worker claims it (`extracting`, with a lease), and it ends
 * - `published`: a candidate exists and the AI-read values are live, or
 * - `needs_matching`: read, but nobody could be created from it yet — an
 *   admin finishes it on /admin/affidavits, or
 * - `failed`: the model could not be made to read it.
 *
 * A failure is never turned into "not declared": that would publish a false
 * statement about a candidate as official affidavit data. A failed
 * affidavit publishes nothing.
 *
 * Logs carry ids, states and counts only — never a name or a value.
 */
import { createHash } from 'node:crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { candidateAffidavits, candidates, media, wards } from '../db/schema';
import type { AffidavitExtraction, ExtractionFailure, ExtractionOutcome } from './affidavit-extraction';
import { fieldsFromExtraction, moveCandidateWard, publishAffidavitFields, publishWardLabel, type PublishActor } from './affidavit-publish';
import { createCandidateTx } from './publish';
import { storeMedia, type MediaStoreErrorCode } from './media';
import { translateFieldSoon } from './translate-runtime';
import { logEvent } from './log';

export const MAX_ATTEMPTS = 3;
/** How long a worker may hold an affidavit before another may take it. The SDK's own call timeout is 10 minutes. */
const LEASE_MINUTES = 15;

/** `wards.id` is corporation index × 1000 + the ward number citizens see (scripts/seed-wards.ts). */
const CORPORATION_INDEX: Record<string, number> = { central: 1, north: 2, east: 3, south: 4, west: 5 };

export type MatchReason = 'ward_unresolved' | 'possible_duplicate' | 'reported_by_transcriber';

export type EnqueueResult =
  | { kind: 'queued'; id: number }
  | { kind: 'duplicate'; id: number }
  | { kind: 'rejected'; reason: MediaStoreErrorCode };

export interface EnqueueOptions {
  uploadedBy: number;
  /** The EC URL the bytes were fetched from, when they were. */
  originUrl?: string | null;
  /** Set when the upload is for a known candidate: the worker then publishes onto it and reads no identity. */
  candidateId?: number | null;
}

async function findBySha(sha256: string): Promise<number | null> {
  const [row] = await db.select({ id: candidateAffidavits.id }).from(candidateAffidavits).where(eq(candidateAffidavits.sha256, sha256));
  return row?.id ?? null;
}

/**
 * Stores a PDF and queues it for extraction. The same bytes are only ever
 * queued once: a second upload, including one racing the first, reports the
 * existing affidavit and stores nothing.
 */
export async function enqueueAffidavit(bytes: Buffer, opts: EnqueueOptions): Promise<EnqueueResult> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const existing = await findBySha(sha256);
  if (existing !== null) return { kind: 'duplicate', id: existing };

  let mediaId: number;
  try {
    mediaId = (await storeMedia({ userId: opts.uploadedBy }, { bytes }, 'affidavit')).id;
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'unsupported_media_type' || code === 'media_too_large') return { kind: 'rejected', reason: code };
    throw err;
  }

  const [row] = await db
    .insert(candidateAffidavits)
    .values({ mediaId, sha256, originUrl: opts.originUrl ?? null, candidateId: opts.candidateId ?? null })
    .onConflictDoNothing({ target: candidateAffidavits.sha256 })
    .returning({ id: candidateAffidavits.id });

  if (!row) {
    // Lost a race with an identical upload: keep theirs, drop our copy of the file.
    await db.delete(media).where(eq(media.id, mediaId));
    const winner = await findBySha(sha256);
    if (winner === null) throw new Error('enqueueAffidavit: duplicate hash but no affidavit row');
    return { kind: 'duplicate', id: winner };
  }

  logEvent('affidavit_queued', { affidavitId: row.id });
  return { kind: 'queued', id: row.id };
}

export interface ClaimedAffidavit {
  id: number;
  mediaId: number;
  candidateId: number | null;
  attempts: number;
}

/**
 * Takes the oldest waiting affidavit for this worker, or returns null when
 * none is waiting. One statement: `SKIP LOCKED` means two workers asking at
 * the same instant get different rows, and a row whose lease has run out
 * (its worker died) is waiting again.
 */
export async function claimNextAffidavit(): Promise<ClaimedAffidavit | null> {
  const rows = await db.execute<{ id: number; media_id: number; candidate_id: number | null; attempts: number }>(sql`
    UPDATE candidate_affidavits
       SET state = 'extracting',
           attempts = attempts + 1,
           lease_expires_at = now() + make_interval(mins => ${LEASE_MINUTES})
     WHERE id = (
       SELECT id FROM candidate_affidavits
        WHERE state = 'queued' OR (state = 'extracting' AND lease_expires_at < now())
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING id, media_id, candidate_id, attempts
  `);
  const row = rows[0];
  return row ? { id: row.id, mediaId: row.media_id, candidateId: row.candidate_id, attempts: row.attempts } : null;
}

/** Lower-case letters and digits, words sorted: how two spellings of a name or ward are compared. */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
}

/**
 * The ward an AI-read ward refers to, or null unless exactly one ward fits.
 * With a corporation the ward number is enough. Without one, the number
 * must belong to a ward whose English name matches the name read.
 */
export async function resolveWard(ward: AffidavitExtraction['identity']['ward']): Promise<number | null> {
  if (ward.status !== 'value' || ward.number === null || ward.number < 1 || ward.number > 999) return null;

  if (ward.corporation !== null) {
    const id = CORPORATION_INDEX[ward.corporation] * 1000 + ward.number;
    const [row] = await db.select({ id: wards.id }).from(wards).where(and(eq(wards.id, id), eq(wards.corporation, ward.corporation)));
    return row?.id ?? null;
  }

  if (ward.name === null) return null;
  // `wards.name_en` carries the ward number in front ("11 - Old
  // Baiyappanahalli"); an affidavit may or may not repeat it. Compare names
  // without it — the number is matched on its own above.
  const bare = (name: string) => normalizeForMatch(name.replace(/^\s*\d+\s*-\s*/, ''));
  const wanted = bare(ward.name);
  if (wanted === '') return null;
  const sameNumber = await db.select({ id: wards.id, nameEn: wards.nameEn }).from(wards).where(sql`${wards.id} % 1000 = ${ward.number}`);
  const matches = sameNumber.filter((w) => w.id < 6000 && bare(w.nameEn) === wanted);
  return matches.length === 1 ? matches[0].id : null;
}

function sourceUrlOf(mediaId: number, sha256: string): string {
  return `/media/${mediaId}/${sha256.slice(0, 16)}`;
}

const SYSTEM: PublishActor = { userId: null, role: 'system' };

/**
 * Publishes a stored extraction onto a NEW candidate in `wardId`, inside the
 * caller's transaction, and marks the affidavit published. Shared by the
 * worker (AI-read identity) and the admin matching page (`identity` given:
 * a person chose the ward and confirmed the name and party).
 */
export async function publishExtractionTx(
  tx: Tx,
  affidavit: { id: number; mediaId: number; sha256: string },
  extraction: AffidavitExtraction,
  target:
    | { kind: 'new'; wardId: number; name: string; party: string; confirmedBy: { userId: number; role: 'curator' | 'admin' } | null }
    | { kind: 'existing'; candidateId: number; identity: boolean },
): Promise<{ candidateId: number; translate: number[] }> {
  const sourceUrl = sourceUrlOf(affidavit.mediaId, affidavit.sha256);
  const all = fieldsFromExtraction(extraction);
  const identityKeys = new Set(['full_name', 'party']);
  const translate: number[] = [];
  let candidateId: number;

  if (target.kind === 'new') {
    candidateId = (await createCandidateTx(tx, { wardId: target.wardId, nameEn: target.name, partyEn: target.party })).id;
    if (target.confirmedBy === null) {
      translate.push(...(await publishAffidavitFields(tx, SYSTEM, candidateId, all, { sourceUrl, checked: false })));
    } else {
      // A person confirmed who this is; the affidavit's other values are still only AI-read.
      const confirmer: PublishActor = { userId: target.confirmedBy.userId, role: target.confirmedBy.role };
      const confirmed = [
        { key: 'full_name' as const, status: 'value' as const, text: target.name },
        { key: 'party' as const, status: 'value' as const, text: target.party },
      ];
      translate.push(...(await publishAffidavitFields(tx, confirmer, candidateId, confirmed, { sourceUrl, checked: true })));
      const rest = all.filter((f) => !identityKeys.has(f.key));
      translate.push(...(await publishAffidavitFields(tx, SYSTEM, candidateId, rest, { sourceUrl, checked: false })));
    }
    await publishWardLabel(tx, candidateId, { sourceUrl, aiExtracted: target.confirmedBy === null });
  } else {
    // The candidate was named by a person already; the affidavit never renames them.
    candidateId = target.candidateId;
    const fields = target.identity ? all : all.filter((f) => !identityKeys.has(f.key));
    translate.push(...(await publishAffidavitFields(tx, SYSTEM, candidateId, fields, { sourceUrl, checked: false })));
  }

  await tx
    .update(candidateAffidavits)
    .set({ state: 'published', candidateId, leaseExpiresAt: null, failure: null, matchReason: null })
    .where(eq(candidateAffidavits.id, affidavit.id));

  return { candidateId, translate };
}

/** Whether the ward already has a candidate whose name reads the same. */
export async function findSameNameCandidate(tx: Tx, wardId: number, name: string): Promise<number | null> {
  const wanted = normalizeForMatch(name);
  const rows = await tx.select({ id: candidates.id, nameEn: candidates.nameEn }).from(candidates).where(eq(candidates.wardId, wardId));
  return rows.find((c) => normalizeForMatch(c.nameEn) === wanted)?.id ?? null;
}

/**
 * Records a successful extraction and publishes it if it can be tied to a
 * candidate without a person: the affidavit was uploaded for one, or its
 * AI-read ward resolves, its name and party were read, and the ward has no
 * candidate of that name yet. Otherwise it waits on the admin page.
 */
export async function completeExtraction(id: number, extraction: AffidavitExtraction): Promise<'published' | 'needs_matching'> {
  const wardId = await resolveWard(extraction.identity.ward);

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: candidateAffidavits.id, mediaId: candidateAffidavits.mediaId, candidateId: candidateAffidavits.candidateId, sha256: media.sha256 })
      .from(candidateAffidavits)
      .innerJoin(media, eq(media.id, candidateAffidavits.mediaId))
      .where(eq(candidateAffidavits.id, id))
      .for('update', { of: candidateAffidavits });
    if (!row) throw new Error(`completeExtraction: no affidavit ${id}`);

    await tx
      .update(candidateAffidavits)
      .set({ extraction, confidence: extraction.confidence, leaseExpiresAt: null, failure: null })
      .where(eq(candidateAffidavits.id, id));

    if (row.candidateId !== null) {
      const { translate } = await publishExtractionTx(tx, row, extraction, { kind: 'existing', candidateId: row.candidateId, identity: false });
      return { state: 'published' as const, translate };
    }

    const { name, party } = extraction.identity;
    const waitFor = async (reason: MatchReason) => {
      await tx.update(candidateAffidavits).set({ state: 'needs_matching', matchReason: reason }).where(eq(candidateAffidavits.id, id));
      return { state: 'needs_matching' as const, translate: [] as number[] };
    };

    if (wardId === null || name.status !== 'value' || party.status !== 'value') return waitFor('ward_unresolved');
    if ((await findSameNameCandidate(tx, wardId, name.text!)) !== null) return waitFor('possible_duplicate');

    const { translate } = await publishExtractionTx(tx, row, extraction, {
      kind: 'new',
      wardId,
      name: name.text!.trim(),
      party: party.text!.trim(),
      confirmedBy: null,
    });
    return { state: 'published' as const, translate };
  });

  for (const fieldId of result.translate) translateFieldSoon({ table: 'candidate_fields', id: fieldId });
  logEvent('affidavit_extracted', { affidavitId: id, state: result.state });
  return result.state;
}

/**
 * Records a failed attempt. The affidavit goes back to the queue until it
 * has used its attempts; a refusal is not retried, since asking again gets
 * the same answer.
 */
export async function failExtraction(id: number, failure: ExtractionFailure, detail: string): Promise<'queued' | 'failed'> {
  const [row] = await db.select({ attempts: candidateAffidavits.attempts }).from(candidateAffidavits).where(eq(candidateAffidavits.id, id));
  if (!row) throw new Error(`failExtraction: no affidavit ${id}`);
  const state = failure === 'refusal' || row.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
  await db
    .update(candidateAffidavits)
    .set({ state, leaseExpiresAt: null, failure: `${failure}: ${detail}`.slice(0, 500) })
    .where(eq(candidateAffidavits.id, id));
  logEvent('affidavit_extraction_failed', { affidavitId: id, failure, state });
  return state;
}

export type Extractor = (pdfBytes: Buffer) => Promise<ExtractionOutcome>;

/**
 * Claims and processes one affidavit. Returns false when the queue is
 * empty. Never throws for a problem with one affidavit: whatever goes
 * wrong is recorded on that row so the loop moves on to the next.
 */
export async function processOne(extractor: Extractor): Promise<boolean> {
  const claimed = await claimNextAffidavit();
  if (!claimed) return false;

  try {
    const [stored] = await db.select({ bytes: media.bytes }).from(media).where(eq(media.id, claimed.mediaId));
    if (!stored) throw new Error('stored PDF is missing');

    const outcome = await extractor(stored.bytes);
    if (outcome.ok) {
      await completeExtraction(claimed.id, outcome.extraction);
    } else {
      await failExtraction(claimed.id, outcome.failure, outcome.detail);
    }
  } catch (err) {
    // The message of an unexpected error is ours or a library's, not affidavit content.
    await failExtraction(claimed.id, 'api_error', err instanceof Error ? err.message : String(err));
  }
  return true;
}

// ---------------------------------------------------------------------------
// /admin/affidavits: what waits on a person, and what an admin can do about it.
// ---------------------------------------------------------------------------

export type AffidavitState = (typeof candidateAffidavits.$inferSelect)['state'];

export interface MatchRow {
  id: number;
  pdfUrl: string;
  reason: MatchReason;
  /** A transcriber's note when they sent the affidavit back (`reported_by_transcriber`). */
  note: string | null;
  confidence: number | null;
  name: string;
  party: string;
  /** The name and party as the AI read them, whatever `name` and `party` hold now; null when it read none. */
  nameRead: string | null;
  partyRead: string | null;
  gender: string | null;
  /** The ward as the AI read it, for the admin to compare against the PDF; null when it read none. */
  wardRead: string | null;
  /** The candidate this affidavit is already published on, when a transcriber sent it back. */
  candidateId: number | null;
  /** That candidate's ward today, to pre-select; null when there is no candidate yet. */
  currentWardId: number | null;
  /** Candidates of the same name, for a possible duplicate. */
  sameName: Array<{ id: number; nameEn: string; wardId: number }>;
}

export interface FailedRow {
  id: number;
  pdfUrl: string;
  failure: string;
  attempts: number;
  canDiscard: boolean;
}

export interface AffidavitAdminData {
  counts: Record<AffidavitState, number>;
  needsMatching: MatchRow[];
  failed: FailedRow[];
}

/** A value a serial `integer` id can hold: anything else, typed into a URL or a form, matches no row. */
function isRowId(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 2147483647;
}

function wardReadText(ward: AffidavitExtraction['identity']['ward'] | undefined): string | null {
  if (!ward || ward.status !== 'value') return null;
  return [ward.number, ward.name, ward.corporation].filter((part) => part !== null).join(' · ');
}

/**
 * The waiting (`needs_matching`) affidavits matching `where`, oldest first,
 * each as the form shows it.
 */
async function matchRows(where: SQL): Promise<MatchRow[]> {
  const waiting = await db
    .select({
      id: candidateAffidavits.id,
      mediaId: candidateAffidavits.mediaId,
      sha256: media.sha256,
      matchReason: candidateAffidavits.matchReason,
      matchNote: candidateAffidavits.matchNote,
      confidence: candidateAffidavits.confidence,
      extraction: candidateAffidavits.extraction,
      candidateId: candidateAffidavits.candidateId,
    })
    .from(candidateAffidavits)
    .innerJoin(media, eq(media.id, candidateAffidavits.mediaId))
    .where(and(eq(candidateAffidavits.state, 'needs_matching'), where))
    .orderBy(candidateAffidavits.id);
  if (waiting.length === 0) return [];

  // Every candidate's name, read once, for the "same person as" suggestions
  // (not once per waiting row: there may be hundreds of rows and thousands
  // of candidates).
  const byName = new Map<string, Array<{ id: number; nameEn: string; wardId: number }>>();
  const all = await db.select({ id: candidates.id, nameEn: candidates.nameEn, wardId: candidates.wardId }).from(candidates);
  for (const c of all) {
    const key = normalizeForMatch(c.nameEn);
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }

  const rows: MatchRow[] = [];
  for (const row of waiting) {
    const identity = (row.extraction as AffidavitExtraction | null)?.identity;
    // A sent-back affidavit already has a candidate, possibly renamed since
    // the AI read it: the form starts from what is published, so saving a
    // ward correction cannot quietly undo a name correction.
    const [current] =
      row.candidateId === null
        ? []
        : await db
            .select({ nameEn: candidates.nameEn, partyEn: candidates.partyEn, wardId: candidates.wardId })
            .from(candidates)
            .where(eq(candidates.id, row.candidateId));
    const name = current?.nameEn ?? identity?.name.text ?? '';
    const sameName = name === '' ? [] : (byName.get(normalizeForMatch(name)) ?? []).filter((c) => c.id !== row.candidateId);
    rows.push({
      id: row.id,
      pdfUrl: sourceUrlOf(row.mediaId, row.sha256),
      reason: (row.matchReason as MatchReason | null) ?? 'ward_unresolved',
      note: row.matchNote,
      confidence: row.confidence,
      name,
      party: current?.partyEn ?? identity?.party.text ?? '',
      nameRead: identity?.name.text ?? null,
      partyRead: identity?.party.text ?? null,
      gender: identity?.gender.gender ?? null,
      wardRead: wardReadText(identity?.ward),
      candidateId: row.candidateId,
      currentWardId: current?.wardId ?? null,
      sameName,
    });
  }
  return rows;
}

/** Every affidavit waiting for a person to say who it is and where, oldest first. */
export async function loadMatchList(): Promise<MatchRow[]> {
  return matchRows(sql`true`);
}

/** One waiting affidavit, or null unless it is waiting (unknown, published, failed, or resolved a moment ago). */
export async function loadMatchItem(id: number): Promise<MatchRow | null> {
  if (!isRowId(id)) return null;
  return (await matchRows(eq(candidateAffidavits.id, id)))[0] ?? null;
}

/** How many affidavits are waiting to be matched: the number on the curator's dashboard. */
export async function countWaitingMatches(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(candidateAffidavits).where(eq(candidateAffidavits.state, 'needs_matching'));
  return row?.n ?? 0;
}

export async function loadAffidavitAdmin(): Promise<AffidavitAdminData> {
  const counts: Record<AffidavitState, number> = { queued: 0, extracting: 0, needs_matching: 0, published: 0, failed: 0 };
  const countRows = await db
    .select({ state: candidateAffidavits.state, n: sql<number>`count(*)::int` })
    .from(candidateAffidavits)
    .groupBy(candidateAffidavits.state);
  for (const row of countRows) counts[row.state] = row.n;

  const failedRows = await db
    .select({
      id: candidateAffidavits.id,
      mediaId: candidateAffidavits.mediaId,
      sha256: media.sha256,
      failure: candidateAffidavits.failure,
      attempts: candidateAffidavits.attempts,
      candidateId: candidateAffidavits.candidateId,
    })
    .from(candidateAffidavits)
    .innerJoin(media, eq(media.id, candidateAffidavits.mediaId))
    .where(eq(candidateAffidavits.state, 'failed'))
    .orderBy(candidateAffidavits.id);
  const failed: FailedRow[] = failedRows.map((row) => ({
    id: row.id,
    pdfUrl: sourceUrlOf(row.mediaId, row.sha256),
    failure: row.failure ?? '',
    attempts: row.attempts,
    canDiscard: row.candidateId === null,
  }));

  return { counts, needsMatching: await loadMatchList(), failed };
}

export type AdminActionError = 'not_waiting' | 'unknown_ward' | 'name_required' | 'party_required' | 'unknown_candidate' | 'attached' | 'not_failed';

export interface ConfirmMatchInput {
  wardId: number;
  name: string;
  party: string;
  /** Publish onto this existing candidate instead of creating one: an admin or a curator judged it the same person. */
  attachToCandidateId?: number;
}

/**
 * An admin's or a curator's answer for an affidavit the worker could not place: which ward,
 * and the name and party as they should read. Creates the candidate and
 * publishes the stored extraction — identity as checked by a person, the
 * affidavit's values still AI-labelled. Throws an `AdminActionError` code.
 *
 * For an affidavit a transcriber sent back, the candidate already exists:
 * it is moved to the chosen ward and renamed, and its values are left alone.
 */
export async function confirmMatch(actor: { userId: number; role: 'curator' | 'admin' }, id: number, input: ConfirmMatchInput): Promise<{ candidateId: number }> {
  const name = input.name.trim();
  const party = input.party.trim();
  if (name === '') throw new Error('name_required' satisfies AdminActionError);
  if (party === '') throw new Error('party_required' satisfies AdminActionError);
  const [ward] = isRowId(input.wardId) ? await db.select({ id: wards.id }).from(wards).where(eq(wards.id, input.wardId)) : [];
  if (!ward) throw new Error('unknown_ward' satisfies AdminActionError);

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: candidateAffidavits.id,
        mediaId: candidateAffidavits.mediaId,
        sha256: media.sha256,
        state: candidateAffidavits.state,
        extraction: candidateAffidavits.extraction,
        candidateId: candidateAffidavits.candidateId,
      })
      .from(candidateAffidavits)
      .innerJoin(media, eq(media.id, candidateAffidavits.mediaId))
      .where(eq(candidateAffidavits.id, id))
      .for('update', { of: candidateAffidavits });
    if (!row || row.state !== 'needs_matching' || row.extraction === null) throw new Error('not_waiting' satisfies AdminActionError);
    const extraction = row.extraction as AffidavitExtraction;
    const sourceUrl = sourceUrlOf(row.mediaId, row.sha256);

    if (row.candidateId !== null) {
      // Sent back by a transcriber: correct who and where, keep the values.
      await moveCandidateWard(tx, row.candidateId, ward.id, sourceUrl);
      const translate = await publishAffidavitFields(
        tx,
        { userId: actor.userId, role: actor.role },
        row.candidateId,
        [
          { key: 'full_name', status: 'value', text: name },
          { key: 'party', status: 'value', text: party },
        ],
        { sourceUrl, checked: true },
      );
      await tx.update(candidateAffidavits).set({ state: 'published', matchReason: null, matchNote: null }).where(eq(candidateAffidavits.id, id));
      return { candidateId: row.candidateId, translate };
    }

    if (input.attachToCandidateId !== undefined) {
      const [existing] = isRowId(input.attachToCandidateId) ? await tx.select({ id: candidates.id }).from(candidates).where(eq(candidates.id, input.attachToCandidateId)) : [];
      if (!existing) throw new Error('unknown_candidate' satisfies AdminActionError);
      return publishExtractionTx(tx, row, extraction, { kind: 'existing', candidateId: existing.id, identity: false });
    }

    return publishExtractionTx(tx, row, extraction, { kind: 'new', wardId: ward.id, name, party, confirmedBy: { userId: actor.userId, role: actor.role } });
  });

  for (const fieldId of result.translate) translateFieldSoon({ table: 'candidate_fields', id: fieldId });
  logEvent('affidavit_matched', { affidavitId: id, by: actor.userId, role: actor.role });
  return { candidateId: result.candidateId };
}

/** Puts a failed affidavit back in the queue with a fresh set of attempts. */
export async function retryAffidavit(id: number): Promise<void> {
  const rows = await db
    .update(candidateAffidavits)
    .set({ state: 'queued', attempts: 0, failure: null, leaseExpiresAt: null })
    .where(and(eq(candidateAffidavits.id, id), eq(candidateAffidavits.state, 'failed')))
    .returning({ id: candidateAffidavits.id });
  if (rows.length === 0) throw new Error('not_failed' satisfies AdminActionError);
}

/**
 * Deletes an affidavit nobody could use, and its stored PDF. Refused once a
 * candidate is attached: the PDF is then the public source behind that
 * candidate's values.
 */
export async function discardAffidavit(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ mediaId: candidateAffidavits.mediaId, state: candidateAffidavits.state, candidateId: candidateAffidavits.candidateId })
      .from(candidateAffidavits)
      .where(eq(candidateAffidavits.id, id))
      .for('update');
    if (!row || (row.state !== 'failed' && row.state !== 'needs_matching')) throw new Error('not_waiting' satisfies AdminActionError);
    if (row.candidateId !== null) throw new Error('attached' satisfies AdminActionError);
    await tx.delete(candidateAffidavits).where(eq(candidateAffidavits.id, id));
    await tx.delete(media).where(eq(media.id, row.mediaId));
  });
  logEvent('affidavit_discarded', { affidavitId: id });
}
