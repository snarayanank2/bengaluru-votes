/**
 * A curator's correction to one published value, wherever it is made: from
 * a citizen's flag (`/curator/queue/{id}`) or in the candidate editor
 * (`/curator/candidate/{id}`). A correction is one affidavit field typed
 * into that field's structured inputs, or the candidate moved to another
 * ward. Both are checked against the stored affidavit, which is the source
 * the published value points to: a candidate with no affidavit has nothing
 * to correct against.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { candidateAffidavits, candidateFields, candidates, media, wards } from '../db/schema';
import { AFFIDAVIT_FIELD_KEYS, moveCandidateWard, publishAffidavitFields, type AffidavitFieldKey, type FieldData, type FieldStatus } from './affidavit-publish';
import { FIELD_INPUTS, errorFor, fieldFromInputs, inputsOf, readFieldForm, storedFieldData, type FieldError, type RawField } from './affidavit-form';
import { translateFieldSoon } from './translate-runtime';

/** Same shape `src/middleware.ts` puts on `locals.session` for a signed-in curator or admin. */
export type StaffActor = { userId: number; role: 'curator' | 'admin' };

export interface WardOption {
  id: number;
  label: string;
}

export interface FixCandidate {
  id: number;
  slug: string;
  nameEn: string;
  partyEn: string;
  wardId: number;
  wardNameEn: string;
  wardNameKn: string;
  /** The stored affidavit every value points to; null for a candidate with no published affidavit. */
  pdfUrl: string | null;
  /** With no published affidavit: the candidate's affidavit that waits in Matching, if there is one. */
  waitingAffidavitId: number | null;
}

/** One field as the fix form shows it. */
export interface FixField {
  key: AffidavitFieldKey;
  status: FieldStatus;
  inputs: Record<string, string>;
  /** The published text, or null when nothing is published. */
  valueEn: string | null;
  aiExtracted: boolean;
  checked: boolean;
}

export type ParsedField = { ok: true; data: FieldData } | { ok: false; key: string; error?: FieldError; raw: RawField };
export type ParsedWard = { ok: true; wardId: number } | { ok: false; key: string };

/** "South 14 · Hebbal": `name_en` already starts with the ward number ("14 - Hebbal"). */
export function wardOptionLabel(ward: { id: number; nameEn: string; corporation: string }): string {
  const corporation = ward.corporation[0]!.toUpperCase() + ward.corporation.slice(1);
  return `${corporation} ${ward.id % 1000} · ${ward.nameEn.replace(/^\d+\s*-\s*/, '')}`;
}

export async function loadWardOptions(): Promise<WardOption[]> {
  const rows = await db.select({ id: wards.id, nameEn: wards.nameEn, corporation: wards.corporation }).from(wards).orderBy(wards.corporation, wards.id);
  return rows.map((row) => ({ id: row.id, label: wardOptionLabel(row) }));
}

/** The candidate's most recently stored affidavit that has been published, or null. */
export async function latestAffidavitOf(candidateId: number): Promise<{ pdfUrl: string } | null> {
  const [row] = await db
    .select({ mediaId: media.id, sha256: media.sha256 })
    .from(candidateAffidavits)
    .innerJoin(media, eq(media.id, candidateAffidavits.mediaId))
    .where(and(eq(candidateAffidavits.candidateId, candidateId), eq(candidateAffidavits.state, 'published')))
    .orderBy(desc(candidateAffidavits.createdAt), desc(candidateAffidavits.id))
    .limit(1);
  return row ? { pdfUrl: `/media/${row.mediaId}/${row.sha256.slice(0, 16)}` } : null;
}

/**
 * The candidate's most recent affidavit that waits in Matching, or null:
 * one a transcriber sent back keeps its candidate but is no longer
 * `published`, so `latestAffidavitOf` does not see it.
 */
export async function waitingAffidavitOf(candidateId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: candidateAffidavits.id })
    .from(candidateAffidavits)
    .where(and(eq(candidateAffidavits.candidateId, candidateId), eq(candidateAffidavits.state, 'needs_matching')))
    .orderBy(desc(candidateAffidavits.createdAt), desc(candidateAffidavits.id))
    .limit(1);
  return row?.id ?? null;
}

export async function loadFixCandidate(candidateId: number): Promise<FixCandidate | null> {
  const [row] = await db
    .select({ id: candidates.id, slug: candidates.slug, nameEn: candidates.nameEn, partyEn: candidates.partyEn, wardId: wards.id, wardNameEn: wards.nameEn, wardNameKn: wards.nameKn })
    .from(candidates)
    .innerJoin(wards, eq(wards.id, candidates.wardId))
    .where(eq(candidates.id, candidateId));
  if (!row) return null;
  const pdfUrl = (await latestAffidavitOf(candidateId))?.pdfUrl ?? null;
  return { ...row, pdfUrl, waitingAffidavitId: pdfUrl ? null : await waitingAffidavitOf(candidateId) };
}

/** What is published for `key` as a structured value. Name and party come from the candidate row, which is what the public page shows. */
function structured(candidate: FixCandidate, key: AffidavitFieldKey, stored: typeof candidateFields.$inferSelect | undefined): FieldData | null {
  if (key === 'full_name') return { key, status: 'value', text: candidate.nameEn };
  if (key === 'party') return { key, status: 'value', text: candidate.partyEn };
  return storedFieldData(key, stored?.valueData);
}

/** All seven affidavit fields, in `AFFIDAVIT_FIELD_KEYS` order, each as its fix form opens. */
export async function loadFixFields(candidate: FixCandidate): Promise<FixField[]> {
  const rows = await db.select().from(candidateFields).where(eq(candidateFields.candidateId, candidate.id));
  const byKey = new Map(rows.map((row) => [row.fieldKey, row]));
  return AFFIDAVIT_FIELD_KEYS.map((key) => {
    const stored = byKey.get(key);
    const data = structured(candidate, key, stored);
    // Free text with no structure behind it: keep what the row says about the answer, and leave the inputs empty.
    const status: FieldStatus = data?.status ?? (stored?.unreadable ? 'unreadable' : stored?.notDeclared ? 'not_declared' : 'value');
    return {
      key,
      status,
      inputs: data ? inputsOf(data) : Object.fromEntries(FIELD_INPUTS[key].map((name) => [name, ''])),
      valueEn: key === 'full_name' ? candidate.nameEn : key === 'party' ? candidate.partyEn : (stored?.valueEn ?? null),
      aiExtracted: stored?.aiExtracted ?? false,
      checked: stored?.checkedBy != null,
    };
  });
}

export async function publishedFieldData(candidate: FixCandidate, key: AffidavitFieldKey): Promise<FieldData | null> {
  const [stored] = await db.select().from(candidateFields).where(and(eq(candidateFields.candidateId, candidate.id), eq(candidateFields.fieldKey, key)));
  return structured(candidate, key, stored);
}

/**
 * Whether a correction is exactly what is published already: the same
 * answer and the same value in every part, text compared after trimming
 * only. Unlike `sameFieldData` this is case-sensitive, because changing
 * "RAVI KUMAR" to "Ravi Kumar" is a correction. Compared part by part, not
 * as serialised JSON: a stored value comes back from `jsonb` with its keys
 * in another order. Blank text and a missing part are the same nothing.
 */
function unchanged(data: FieldData, published: FieldData): boolean {
  const part = (value: unknown) => (typeof value === 'string' ? value.trim() || null : (value ?? null));
  const a = data as Record<string, unknown>;
  const b = published as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((name) => part(a[name]) === part(b[name]));
}

/** One field's posted correction: refused without the confirmation tick, when invalid, or when it is what is published already. */
export function parseFieldFix(form: FormData, key: AffidavitFieldKey, published: FieldData | null): ParsedField {
  const raw = readFieldForm(form, key);
  if (form.get('confirmPublish') == null) return { ok: false, key: 'curator.fix.error.confirmRequired', raw };
  const data = fieldFromInputs(key, raw.status, raw.inputs);
  const error = errorFor(data, raw.inputs);
  if (error) return { ok: false, key: `transcribe.error.${error}`, error, raw };
  if (published && unchanged(data, published)) return { ok: false, key: 'curator.fix.error.unchanged', raw };
  return { ok: true, data };
}

/** The posted ward: refused without the confirmation tick, when it is not a ward, or when the candidate is in it already. */
export async function parseWardFix(form: FormData, currentWardId: number): Promise<ParsedWard> {
  if (form.get('confirmPublish') == null) return { ok: false, key: 'curator.fix.error.confirmRequired' };
  const raw = String(form.get('wardId') ?? '').trim();
  const wardId = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  const [ward] = Number.isInteger(wardId) ? await db.select({ id: wards.id }).from(wards).where(eq(wards.id, wardId)) : [];
  if (!ward) return { ok: false, key: 'curator.fix.error.unknownWard' };
  if (ward.id === currentWardId) return { ok: false, key: 'curator.fix.error.unchanged' };
  return { ok: true, wardId: ward.id };
}

/** Publishes one corrected field outside any flag (the candidate editor). */
export async function saveFieldFix(actor: StaffActor, candidateId: number, data: FieldData, sourceUrl: string): Promise<void> {
  const translate = await db.transaction((tx) => publishAffidavitFields(tx, actor, candidateId, [data], { sourceUrl, checked: true }));
  for (const fieldId of translate) translateFieldSoon({ table: 'candidate_fields', id: fieldId });
}

/** Moves a candidate to another ward outside any flag (the candidate editor). */
export async function saveWardFix(candidateId: number, wardId: number, sourceUrl: string): Promise<void> {
  await db.transaction((tx) => moveCandidateWard(tx, candidateId, wardId, sourceUrl));
}
