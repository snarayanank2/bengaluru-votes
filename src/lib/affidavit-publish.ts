/**
 * The only writer of STRUCTURED candidate field values.
 *
 * A field read from an affidavit has two forms that must never disagree:
 * `candidate_fields.value_data` (the numbers and choices a transcriber
 * edits) and `value_en` (the text the public page shows). Every caller that
 * holds a structured value — the extraction worker, the admin matching page
 * and the transcriber save — goes through `publishAffidavitFields`, which
 * renders the text from the data in the same statement.
 *
 * The curator's free-text editor (src/lib/publish.ts) is the other writer
 * of `value_en`; it clears `value_data`, because its text did not come from
 * a structured value.
 */
import { and, eq, like } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { candidateFields, candidates, flagItems } from '../db/schema';
import { decideTranslationStatus } from './publish';
import { EDUCATION_LEVELS, GENDERS, type AffidavitExtraction, type EducationLevel, type Gender } from './affidavit-extraction';

/** In the order a Form 26 affidavit gives them. The ward is not here: only an admin sets it. */
export const AFFIDAVIT_FIELD_KEYS = ['full_name', 'party', 'gender', 'age', 'education', 'assets', 'cases'] as const;
export type AffidavitFieldKey = (typeof AFFIDAVIT_FIELD_KEYS)[number];

export type FieldStatus = 'value' | 'not_declared' | 'unreadable';

/** The value is present if and only if `status` is `value` (`checkFieldData`). */
export type FieldData =
  | { key: 'full_name' | 'party'; status: FieldStatus; text: string | null }
  | { key: 'gender'; status: FieldStatus; gender: Gender | null }
  | { key: 'age'; status: FieldStatus; years: number | null }
  | { key: 'education'; status: FieldStatus; level: EducationLevel | null; stated: string | null }
  | { key: 'assets'; status: FieldStatus; movableInr: number | null; immovableInr: number | null }
  | { key: 'cases'; status: FieldStatus; pending: number | null; convictions: number | null };

/** `system` is the extraction worker; its values keep the AI-extracted label. */
export type PublishActor = { userId: number | null; role: 'system' | 'admin' | 'curator' | 'transcriber' };

/** Whole rupees in Indian digit grouping: 45210000 -> "₹4,52,10,000". */
export function formatInr(amount: number): string {
  const digits = String(Math.trunc(amount));
  if (digits.length <= 3) return `₹${digits}`;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${rest},${lastThree}`;
}

/** The parts of a field's value, in a fixed order, for checking and comparing. */
function valueParts(data: FieldData): Array<[string, string | number | null]> {
  switch (data.key) {
    case 'full_name':
    case 'party':
      return [['text', data.text]];
    case 'gender':
      return [['gender', data.gender]];
    case 'age':
      return [['years', data.years]];
    case 'education':
      return [['level', data.level], ['stated', data.stated]];
    case 'assets':
      return [['movableInr', data.movableInr], ['immovableInr', data.immovableInr]];
    case 'cases':
      return [['pending', data.pending], ['convictions', data.convictions]];
  }
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * The same rules `checkExtraction` applies to a model's answer, applied to
 * one field from any source. Returns a description of the first problem,
 * or null. The qualification as stated is optional beside an education level.
 */
export function checkFieldData(data: FieldData): string | null {
  for (const [part, value] of valueParts(data)) {
    const optional = data.key === 'education' && part === 'stated';
    if (data.status === 'value' && value === null && !optional) return `${data.key}.${part} is missing`;
    if (data.status !== 'value' && value !== null) return `${data.key}.${part} is set but status is ${data.status}`;
    if (typeof value === 'string' && value.trim() === '' && !optional) return `${data.key}.${part} is empty`;
  }
  if (data.status !== 'value') return null;

  switch (data.key) {
    case 'gender':
      return GENDERS.includes(data.gender!) ? null : 'gender is not a known value';
    case 'age':
      return isWholeNumber(data.years) && data.years >= 1 && data.years <= 120 ? null : 'age.years is out of range';
    case 'education':
      return EDUCATION_LEVELS.includes(data.level!) ? null : 'education.level is not a known level';
    case 'assets':
      if (!isWholeNumber(data.movableInr) || data.movableInr < 0) return 'assets.movableInr must be a whole number of rupees';
      if (!isWholeNumber(data.immovableInr) || data.immovableInr < 0) return 'assets.immovableInr must be a whole number of rupees';
      return null;
    case 'cases':
      if (!isWholeNumber(data.pending) || data.pending < 0) return 'cases.pending must be a whole number';
      if (!isWholeNumber(data.convictions) || data.convictions < 0) return 'cases.convictions must be a whole number';
      return null;
    default:
      return null;
  }
}

/** The English text published for a structured value, or null when there is no value. */
export function renderField(data: FieldData): string | null {
  if (data.status !== 'value') return null;
  switch (data.key) {
    case 'full_name':
    case 'party':
      return data.text!.trim();
    case 'gender':
      return data.gender![0].toUpperCase() + data.gender!.slice(1);
    case 'age':
      return String(data.years);
    case 'education': {
      const stated = data.stated?.trim() ?? '';
      return stated === '' || stated.toLowerCase() === data.level!.toLowerCase() ? data.level! : `${data.level}: ${stated}`;
    }
    case 'assets':
      return `${formatInr(data.movableInr! + data.immovableInr!)} (movable ${formatInr(data.movableInr!)}; immovable ${formatInr(data.immovableInr!)})`;
    case 'cases':
      return `${data.pending} pending, ${data.convictions} convictions`;
  }
}

/** The seven publishable fields of an extraction, in affidavit order. */
export function fieldsFromExtraction(e: AffidavitExtraction): FieldData[] {
  return [
    { key: 'full_name', status: e.identity.name.status, text: e.identity.name.text },
    { key: 'party', status: e.identity.party.status, text: e.identity.party.text },
    { key: 'gender', status: e.identity.gender.status, gender: e.identity.gender.gender },
    { key: 'age', status: e.age.status, years: e.age.years },
    { key: 'education', status: e.education.status, level: e.education.level, stated: e.education.stated },
    { key: 'assets', status: e.assets.status, movableInr: e.assets.movableInr, immovableInr: e.assets.immovableInr },
    { key: 'cases', status: e.cases.status, pending: e.cases.pending, convictions: e.cases.convictions },
  ];
}

/** Whether two readings of one field say the same thing. Text is compared ignoring case and surrounding space. */
export function sameFieldData(a: FieldData, b: FieldData): boolean {
  if (a.key !== b.key || a.status !== b.status) return false;
  const left = valueParts(a);
  const right = valueParts(b);
  return left.every(([, value], i) => {
    const other = right[i][1];
    if (typeof value === 'string' && typeof other === 'string') return value.trim().toLowerCase() === other.trim().toLowerCase();
    return (value ?? null) === (other ?? null);
  });
}

export interface PublishAffidavitOptions {
  /** The stored affidavit PDF these values were read from. */
  sourceUrl: string;
  /** True when a person checked these values against the affidavit. */
  checked: boolean;
  /** What the AI read, when known: lets a checked value record whether the person kept it or changed it. */
  aiFields?: FieldData[];
}

/**
 * Publishes structured values onto a candidate, inside the caller's
 * transaction. Throws before writing anything if any field is inconsistent.
 *
 * The AI-extracted label stays only when the system wrote the value and
 * nobody checked it. A field nobody could read (`unreadable`) is not a
 * checked value, so it never clears a label that was already there.
 *
 * `checked_by`, `checked_at` and `confirmed_ai` are written here and only
 * here for structured values, in the same statement as the value: nothing
 * can say "checked by a person" without a person having published it.
 *
 * Name and party also update the `candidates` row, which is what the public
 * page reads them from; an unreadable or undeclared one leaves it alone.
 *
 * Returns the ids of the field rows whose Kannada now needs translating,
 * for the caller to hand to `translateFieldSoon` after commit.
 */
export async function publishAffidavitFields(
  tx: Tx,
  actor: PublishActor,
  candidateId: number,
  fields: FieldData[],
  opts: PublishAffidavitOptions,
): Promise<number[]> {
  for (const data of fields) {
    const problem = checkFieldData(data);
    if (problem) throw new Error(`publishAffidavitFields: ${problem}`);
  }

  const needsTranslation: number[] = [];
  const now = new Date();

  for (const data of fields) {
    const [existing] = await tx
      .select()
      .from(candidateFields)
      .where(and(eq(candidateFields.candidateId, candidateId), eq(candidateFields.fieldKey, data.key)));

    const valueEn = renderField(data);
    const unreadable = data.status === 'unreadable';
    const humanChecked = opts.checked && actor.role !== 'system' && !unreadable;
    const aiExtracted = humanChecked ? false : unreadable && existing ? existing.aiExtracted : actor.role === 'system' || unreadable;
    const translationStatus = decideTranslationStatus(existing, { valueEn, authoredLang: 'en' });
    const aiField = opts.aiFields?.find((f) => f.key === data.key);

    const values = {
      valueEn,
      // The Kannada was a translation of the old English; a changed value must not keep it.
      valueKn: existing && existing.valueEn === valueEn ? existing.valueKn : null,
      notDeclared: data.status === 'not_declared',
      unreadable,
      valueData: data,
      authoredLang: 'en' as const,
      translationStatus,
      sourceUrl: opts.sourceUrl,
      sourceType: 'official' as const,
      aiExtracted,
      checkedBy: humanChecked ? actor.userId : null,
      checkedAt: humanChecked ? now : null,
      confirmedAi: humanChecked && aiField ? sameFieldData(data, aiField) : null,
      updatedAt: now,
    };

    const [row] = await tx
      .insert(candidateFields)
      .values({ candidateId, fieldKey: data.key, ...values })
      .onConflictDoUpdate({ target: [candidateFields.candidateId, candidateFields.fieldKey], set: values })
      .returning({ id: candidateFields.id });

    if (translationStatus === 'pending' && valueEn !== null) needsTranslation.push(row.id);

    if (data.status === 'value' && data.key === 'full_name') {
      await tx.update(candidates).set({ nameEn: valueEn!, updatedAt: now }).where(eq(candidates.id, candidateId));
    }
    if (data.status === 'value' && data.key === 'party') {
      await tx.update(candidates).set({ partyEn: valueEn!, updatedAt: now }).where(eq(candidates.id, candidateId));
    }
  }

  return needsTranslation;
}

/**
 * Records how the candidate's WARD was established, as the label on the
 * public page's ward row: AI-read and resolved by the worker, or chosen by
 * an admin. The ward itself lives on `candidates.ward_id`.
 */
export async function publishWardLabel(tx: Tx, candidateId: number, opts: { sourceUrl: string; aiExtracted: boolean }): Promise<void> {
  const values = {
    sourceUrl: opts.sourceUrl,
    sourceType: 'official' as const,
    aiExtracted: opts.aiExtracted,
    updatedAt: new Date(),
  };
  await tx
    .insert(candidateFields)
    .values({ candidateId, fieldKey: 'ward', ...values })
    .onConflictDoUpdate({ target: [candidateFields.candidateId, candidateFields.fieldKey], set: values });
}

/**
 * Moves a candidate to another ward because a person said so: the ward row
 * on the public page loses its AI label, and the candidate's pending flags
 * follow it so the queue lists them under the ward the candidate is now in.
 * The slug keeps the old ward number: the candidate's URL does not change.
 */
export async function moveCandidateWard(tx: Tx, candidateId: number, wardId: number, sourceUrl: string): Promise<void> {
  await tx.update(candidates).set({ wardId, updatedAt: new Date() }).where(eq(candidates.id, candidateId));
  await publishWardLabel(tx, candidateId, { sourceUrl, aiExtracted: false });
  await tx
    .update(flagItems)
    .set({ wardId })
    .where(and(eq(flagItems.status, 'pending'), eq(flagItems.targetType, 'candidate_field'), like(flagItems.targetRef, `candidate:${candidateId}:%`)));
}
