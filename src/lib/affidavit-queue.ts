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
import { and, eq, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { candidateAffidavits, candidates, media, wards } from '../db/schema';
import type { AffidavitExtraction, ExtractionFailure, ExtractionOutcome } from './affidavit-extraction';
import { fieldsFromExtraction, publishAffidavitFields, publishWardLabel, type PublishActor } from './affidavit-publish';
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
  const wanted = normalizeForMatch(ward.name);
  const sameNumber = await db.select({ id: wards.id, nameEn: wards.nameEn }).from(wards).where(sql`${wards.id} % 1000 = ${ward.number}`);
  const matches = sameNumber.filter((w) => w.id < 6000 && normalizeForMatch(w.nameEn) === wanted);
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
    | { kind: 'new'; wardId: number; name: string; party: string; confirmedBy: number | null }
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
      // An admin confirmed who this is; the affidavit's other values are still only AI-read.
      const admin: PublishActor = { userId: target.confirmedBy, role: 'admin' };
      const confirmed = [
        { key: 'full_name' as const, status: 'value' as const, text: target.name },
        { key: 'party' as const, status: 'value' as const, text: target.party },
      ];
      translate.push(...(await publishAffidavitFields(tx, admin, candidateId, confirmed, { sourceUrl, checked: true })));
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
