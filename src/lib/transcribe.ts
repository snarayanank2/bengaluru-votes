/**
 * Transcription: one person reads one affidavit they did not choose, and
 * their save publishes at once (docs/milestones.md §10).
 *
 * THE QUEUE HAS NO LIST. `drawAssignment` hands out the next affidavit by a
 * fixed priority — missing data, then low AI confidence, then the rest,
 * random within each — and nothing here lets a caller name the one they
 * want. An assignment is a 45-minute HOLD, not ownership: past its expiry
 * the affidavit is anyone's to draw again, so a half-read one is never
 * stranded. Only affidavits the AI has read are in the queue: one stored
 * before the queue existed has no extraction to check a reading against.
 *
 * AUTHORIZATION IS THE ASSIGNMENT, not the role: every function here that
 * reads or writes takes the caller's id and acts only on an assignment that
 * is open, unexpired and theirs. Anything else behaves as if the assignment
 * did not exist, for an admin too.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { candidateAffidavits, candidateFields, candidates, media, transcriptionAssignments, wards } from '../db/schema';
import { type AffidavitExtraction } from './affidavit-extraction';
import { errorFor, fieldFromInputs, inputsOf, readFieldForm, type FieldError } from './affidavit-form';
import {
  AFFIDAVIT_FIELD_KEYS,
  fieldsFromExtraction,
  publishAffidavitFields,
  type AffidavitFieldKey,
  type FieldData,
  type FieldStatus,
} from './affidavit-publish';
export { FIELD_INPUTS, inputsOf, type FieldError } from './affidavit-form';
import { isUniqueViolation } from './db-errors';
import { getKnownSetting } from './settings';
import { translateFieldSoon } from './translate-runtime';
import { logEvent } from './log';

export const ASSIGNMENT_MINUTES = 45;
/** Used when `low_confidence_threshold` is unset or not a number. A placeholder until the Kannada pilot sets one. */
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 70;

async function lowConfidenceThreshold(): Promise<number> {
  const raw = await getKnownSetting('low_confidence_threshold');
  const value = Number(raw);
  return raw !== null && Number.isInteger(value) && value >= 0 && value <= 100 ? value : DEFAULT_LOW_CONFIDENCE_THRESHOLD;
}

/**
 * The caller's assignment: the one they already hold, or the next affidavit
 * in priority order, or null when nothing is waiting.
 *
 * The pick and the assignment are ONE statement (`pick` locks the row with
 * SKIP LOCKED, `ins` assigns it), so two people asking at the same instant
 * get different affidavits and no caller computes the order. The partial
 * unique index on open assignments is the backstop for the one interleaving
 * row locks cannot see (a pick made on a snapshot taken just before another
 * draw committed): that insert fails and the draw is simply tried again.
 *
 * Expiry runs first, as its own statement in the same transaction, because
 * a statement cannot see its own updates. The advisory lock makes one
 * person's simultaneous requests (a double click, two tabs) take turns, so
 * they all end up with the same single assignment.
 */
export async function drawAssignment(transcriberId: number): Promise<number | null> {
  const threshold = await lowConfidenceThreshold();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7426, ${transcriberId})`);
        await tx.execute(sql`
          UPDATE transcription_assignments SET state = 'abandoned', closed_at = now()
           WHERE state = 'open' AND expires_at < now()
        `);
        const rows = await tx.execute<{ id: number }>(sql`
          WITH mine AS (
            SELECT id FROM transcription_assignments
             WHERE transcriber_id = ${transcriberId} AND state = 'open'
             LIMIT 1
          ), pick AS (
            SELECT a.id FROM candidate_affidavits a
             WHERE a.state = 'published'
               AND a.transcribed_at IS NULL
               AND a.candidate_id IS NOT NULL
               AND a.extraction IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM mine)
               AND NOT EXISTS (SELECT 1 FROM transcription_assignments t WHERE t.affidavit_id = a.id AND t.state = 'open')
             ORDER BY CASE
                 WHEN EXISTS (SELECT 1 FROM candidate_fields f WHERE f.candidate_id = a.candidate_id AND f.unreadable) THEN 1
                 WHEN a.confidence IS NULL OR a.confidence < ${threshold} THEN 2
                 ELSE 3
               END, random()
             FOR UPDATE OF a SKIP LOCKED
             LIMIT 1
          ), ins AS (
            INSERT INTO transcription_assignments (affidavit_id, transcriber_id, expires_at)
            SELECT id, ${transcriberId}, now() + make_interval(mins => ${ASSIGNMENT_MINUTES}) FROM pick
            RETURNING id
          )
          SELECT id FROM mine UNION ALL SELECT id FROM ins
        `);
        const id = rows[0]?.id ?? null;
        if (id !== null) logEvent('transcription_drawn', { assignmentId: id, transcriberId });
        return id;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return null;
}

export interface AssignmentField {
  key: AffidavitFieldKey;
  status: FieldStatus;
  /** Input name -> text to show in it. */
  inputs: Record<string, string>;
  /** Whether the published value still carries the AI-extracted label. */
  aiExtracted: boolean;
  /** Whether a person has already checked the published value. */
  checked: boolean;
  /** The AI's one-line note, for assets and cases. */
  note: string | null;
}

export interface AssignmentView {
  assignmentId: number;
  expiresAt: Date;
  pdfUrl: string;
  confidence: number | null;
  candidate: { id: number; slug: string };
  ward: { id: number; nameEn: string; nameKn: string; corporation: string };
  fields: AssignmentField[];
}

function emptyField(key: AffidavitFieldKey): FieldData {
  return fieldFromInputs(key, 'unreadable', {});
}

/** Finds the caller's open, unexpired assignment, with everything the reading screen and the save need. */
async function findAssignment(transcriberId: number, assignmentId: number) {
  if (!Number.isInteger(assignmentId) || assignmentId < 1 || assignmentId > 2147483647) return null;
  const [row] = await db
    .select({
      assignmentId: transcriptionAssignments.id,
      expiresAt: transcriptionAssignments.expiresAt,
      affidavitId: candidateAffidavits.id,
      mediaId: candidateAffidavits.mediaId,
      sha256: media.sha256,
      confidence: candidateAffidavits.confidence,
      extraction: candidateAffidavits.extraction,
      candidateId: candidates.id,
      slug: candidates.slug,
      nameEn: candidates.nameEn,
      partyEn: candidates.partyEn,
      wardId: wards.id,
      wardNameEn: wards.nameEn,
      wardNameKn: wards.nameKn,
      corporation: wards.corporation,
    })
    .from(transcriptionAssignments)
    .innerJoin(candidateAffidavits, eq(candidateAffidavits.id, transcriptionAssignments.affidavitId))
    .innerJoin(media, eq(media.id, candidateAffidavits.mediaId))
    .innerJoin(candidates, eq(candidates.id, candidateAffidavits.candidateId))
    .innerJoin(wards, eq(wards.id, candidates.wardId))
    .where(
      and(
        eq(transcriptionAssignments.id, assignmentId),
        eq(transcriptionAssignments.transcriberId, transcriberId),
        eq(transcriptionAssignments.state, 'open'),
        sql`${transcriptionAssignments.expiresAt} >= now()`,
      ),
    );
  return row ?? null;
}

/**
 * What the reading screen shows for the caller's assignment, or null unless
 * it is open, unexpired and theirs. Each field is pre-filled with the value
 * that is published now: the structured value if there is one, the
 * candidate's own name and party otherwise, and the AI's reading as a last
 * resort (a row written before values were structured has only text).
 */
export async function loadAssignment(transcriberId: number, assignmentId: number): Promise<AssignmentView | null> {
  const row = await findAssignment(transcriberId, assignmentId);
  if (!row) return null;

  const extraction = row.extraction as AffidavitExtraction | null;
  const ai = new Map((extraction ? fieldsFromExtraction(extraction) : []).map((f) => [f.key, f]));
  const publishedRows = await db.select().from(candidateFields).where(eq(candidateFields.candidateId, row.candidateId));
  const published = new Map(publishedRows.map((f) => [f.fieldKey, f]));

  const fields: AssignmentField[] = AFFIDAVIT_FIELD_KEYS.map((key) => {
    const stored = published.get(key);
    let data = (stored?.valueData as FieldData | null | undefined) ?? ai.get(key) ?? emptyField(key);
    if (data.key !== key) data = ai.get(key) ?? emptyField(key);
    // The candidate row is what the public page shows for these two.
    if (data.key === 'full_name') data = { key: 'full_name', status: 'value', text: row.nameEn };
    if (data.key === 'party') data = { key: 'party', status: 'value', text: row.partyEn };
    return {
      key,
      status: data.status,
      inputs: inputsOf(data),
      aiExtracted: stored?.aiExtracted ?? true,
      checked: stored?.checkedBy != null,
      note: key === 'assets' ? (extraction?.assets.note ?? null) : key === 'cases' ? (extraction?.cases.note ?? null) : null,
    };
  });

  return {
    assignmentId: row.assignmentId,
    expiresAt: row.expiresAt,
    pdfUrl: `/media/${row.mediaId}/${row.sha256.slice(0, 16)}`,
    confidence: row.confidence,
    candidate: { id: row.candidateId, slug: row.slug },
    ward: { id: row.wardId, nameEn: row.wardNameEn, nameKn: row.wardNameKn, corporation: row.corporation },
    fields,
  };
}

/** What the transcriber posted, as posted, so a refused save can show it back unchanged. */
export interface RawForm {
  status: Record<AffidavitFieldKey, FieldStatus>;
  checked: AffidavitFieldKey[];
  inputs: Record<string, string>;
}

export type SubmitOutcome =
  | { kind: 'saved'; candidateId: number; slug: string }
  | { kind: 'expired' }
  | { kind: 'invalid'; errors: Partial<Record<AffidavitFieldKey, FieldError>>; formError?: 'nothing_checked'; raw: RawForm };

export function readForm(form: FormData): RawForm {
  const status = {} as Record<AffidavitFieldKey, FieldStatus>;
  const checked: AffidavitFieldKey[] = [];
  const inputs: Record<string, string> = {};
  for (const key of AFFIDAVIT_FIELD_KEYS) {
    const field = readFieldForm(form, key);
    status[key] = field.status;
    Object.assign(inputs, field.inputs);
    if (form.get(`checked.${key}`) != null) checked.push(key);
  }
  return { status, checked, inputs };
}

/**
 * Saves a reading. Only the fields the transcriber ticked are published —
 * as checked by a person, each recording whether they kept the AI's value —
 * and the rest are not touched. If any ticked field is invalid nothing is
 * written. One transaction: the assignment is re-checked under a lock, so a
 * save that arrives after the hold expired, or twice, writes nothing.
 */
export async function submitAssignment(transcriberId: number, assignmentId: number, form: FormData): Promise<SubmitOutcome> {
  const raw = readForm(form);
  const errors: Partial<Record<AffidavitFieldKey, FieldError>> = {};
  const fields: FieldData[] = [];
  for (const key of raw.checked) {
    const data = fieldFromInputs(key, raw.status[key], raw.inputs);
    const error = errorFor(data, raw.inputs);
    if (error) errors[key] = error;
    else fields.push(data);
  }

  const found = await findAssignment(transcriberId, assignmentId);
  if (!found) return { kind: 'expired' };
  if (raw.checked.length === 0) return { kind: 'invalid', errors, formError: 'nothing_checked', raw };
  if (Object.keys(errors).length > 0) return { kind: 'invalid', errors, raw };

  const extraction = found.extraction as AffidavitExtraction | null;
  const translate = await db.transaction(async (tx) => {
    const closed = await tx
      .update(transcriptionAssignments)
      .set({ state: 'submitted', closedAt: new Date() })
      .where(
        and(
          eq(transcriptionAssignments.id, assignmentId),
          eq(transcriptionAssignments.transcriberId, transcriberId),
          eq(transcriptionAssignments.state, 'open'),
          sql`${transcriptionAssignments.expiresAt} >= now()`,
        ),
      )
      .returning({ id: transcriptionAssignments.id });
    if (closed.length === 0) return null;

    const ids = await publishAffidavitFields(tx, { userId: transcriberId, role: 'transcriber' }, found.candidateId, fields, {
      sourceUrl: `/media/${found.mediaId}/${found.sha256.slice(0, 16)}`,
      checked: true,
      aiFields: extraction ? fieldsFromExtraction(extraction) : undefined,
    });
    await tx.update(candidateAffidavits).set({ transcribedAt: new Date() }).where(eq(candidateAffidavits.id, found.affidavitId));
    return ids;
  });
  if (translate === null) return { kind: 'expired' };

  for (const fieldId of translate) translateFieldSoon({ table: 'candidate_fields', id: fieldId });
  logEvent('transcription_submitted', { assignmentId, transcriberId, checked: fields.length });
  return { kind: 'saved', candidateId: found.candidateId, slug: found.slug };
}

/** Gives the affidavit back to the queue. False unless the assignment is open and the caller's. */
export async function releaseAssignment(transcriberId: number, assignmentId: number): Promise<boolean> {
  if (!Number.isInteger(assignmentId)) return false;
  const rows = await db
    .update(transcriptionAssignments)
    .set({ state: 'abandoned', closedAt: new Date() })
    .where(
      and(
        eq(transcriptionAssignments.id, assignmentId),
        eq(transcriptionAssignments.transcriberId, transcriberId),
        eq(transcriptionAssignments.state, 'open'),
      ),
    )
    .returning({ id: transcriptionAssignments.id });
  if (rows.length > 0) logEvent('transcription_released', { assignmentId, transcriberId });
  return rows.length > 0;
}

/**
 * A transcriber cannot change the ward or swap the document; they send the
 * affidavit to the admin list with a note instead. The candidate's
 * published values stay as they are until the admin acts.
 */
export async function reportWrongDocument(
  transcriberId: number,
  assignmentId: number,
  note: string,
): Promise<'reported' | 'note_required' | 'not_found'> {
  const found = await findAssignment(transcriberId, assignmentId);
  if (!found) return 'not_found';
  const trimmed = note.trim().slice(0, 500);
  if (trimmed === '') return 'note_required';

  const done = await db.transaction(async (tx) => {
    const closed = await tx
      .update(transcriptionAssignments)
      .set({ state: 'abandoned', closedAt: new Date() })
      .where(and(eq(transcriptionAssignments.id, assignmentId), eq(transcriptionAssignments.transcriberId, transcriberId), eq(transcriptionAssignments.state, 'open')))
      .returning({ id: transcriptionAssignments.id });
    if (closed.length === 0) return false;
    await tx
      .update(candidateAffidavits)
      .set({ state: 'needs_matching', matchReason: 'reported_by_transcriber', matchNote: trimmed })
      .where(eq(candidateAffidavits.id, found.affidavitId));
    return true;
  });
  if (!done) return 'not_found';
  logEvent('transcription_reported', { assignmentId, transcriberId });
  return 'reported';
}

/** How many affidavits the caller has submitted since midnight in India. */
export async function countSubmittedToday(transcriberId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transcriptionAssignments)
    .where(
      and(
        eq(transcriptionAssignments.transcriberId, transcriberId),
        eq(transcriptionAssignments.state, 'submitted'),
        sql`${transcriptionAssignments.closedAt} >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC'`,
      ),
    );
  return row?.n ?? 0;
}

/** The caller's open assignment, if they hold one, without drawing. */
export async function currentAssignment(transcriberId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: transcriptionAssignments.id })
    .from(transcriptionAssignments)
    .where(
      and(
        eq(transcriptionAssignments.transcriberId, transcriberId),
        eq(transcriptionAssignments.state, 'open'),
        sql`${transcriptionAssignments.expiresAt} >= now()`,
      ),
    );
  return row?.id ?? null;
}

/** How many affidavits are waiting to be read by anyone. A number only: never which. */
export async function countWaiting(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(candidateAffidavits)
    .where(
      sql`${candidateAffidavits.state} = 'published' AND ${candidateAffidavits.transcribedAt} IS NULL AND ${candidateAffidavits.candidateId} IS NOT NULL AND ${candidateAffidavits.extraction} IS NOT NULL`,
    );
  return row?.n ?? 0;
}
