/**
 * One affidavit field as a form: the strings its inputs carry, the
 * structured value they stand for, and why a value is refused. Shared by
 * the transcriber's reading screen and the curator's fix forms, so a field
 * has one set of inputs and one set of rules wherever a person types it.
 */
import { checkFieldData, type AffidavitFieldKey, type FieldData, type FieldStatus } from './affidavit-publish';
import { EDUCATION_LEVELS, GENDERS, type EducationLevel, type Gender } from './affidavit-extraction';

/** The names of the form inputs that carry each field's value, in screen order. */
export const FIELD_INPUTS: Record<AffidavitFieldKey, readonly string[]> = {
  full_name: ['name'],
  party: ['party'],
  gender: ['gender'],
  age: ['age'],
  education: ['educationLevel', 'educationStated'],
  assets: ['movableInr', 'immovableInr'],
  cases: ['pending', 'convictions'],
};

export const STATUSES: readonly FieldStatus[] = ['value', 'not_declared', 'unreadable'];

/** Why a ticked field was refused; the screen has one sentence for each. */
export type FieldError = 'required' | 'whole_number' | 'age_range' | 'choose';

/** The strings a field's inputs show for a structured value. */
export function inputsOf(data: FieldData): Record<string, string> {
  const text = (value: string | number | null) => (value === null ? '' : String(value));
  switch (data.key) {
    case 'full_name':
      return { name: text(data.text) };
    case 'party':
      return { party: text(data.text) };
    case 'gender':
      return { gender: text(data.gender) };
    case 'age':
      return { age: text(data.years) };
    case 'education':
      return { educationLevel: text(data.level), educationStated: text(data.stated) };
    case 'assets':
      return { movableInr: text(data.movableInr), immovableInr: text(data.immovableInr) };
    case 'cases':
      return { pending: text(data.pending), convictions: text(data.convictions) };
  }
}

/** A whole number typed with optional digit grouping ("1,02,10,000") or spaces; null for anything else. */
function wholeNumber(raw: string): number | null {
  const digits = raw.replace(/[,\s]/g, '');
  if (!/^\d{1,15}$/.test(digits)) return null;
  return Number(digits);
}

/** Builds a field's structured value from the form's strings. Unparseable input becomes null, which `checkFieldData` then refuses. */
export function fieldFromInputs(key: AffidavitFieldKey, status: FieldStatus, inputs: Record<string, string>): FieldData {
  const has = status === 'value';
  const text = (name: string) => (has ? (inputs[name] ?? '').trim() : null);
  const number = (name: string) => (has ? wholeNumber(inputs[name] ?? '') : null);
  switch (key) {
    case 'full_name':
      return { key, status, text: text('name') };
    case 'party':
      return { key, status, text: text('party') };
    case 'gender': {
      const raw = text('gender');
      return { key, status, gender: (GENDERS as readonly string[]).includes(raw ?? '') ? (raw as Gender) : null };
    }
    case 'age':
      return { key, status, years: number('age') };
    case 'education': {
      const raw = text('educationLevel');
      return {
        key,
        status,
        level: (EDUCATION_LEVELS as readonly string[]).includes(raw ?? '') ? (raw as EducationLevel) : null,
        stated: has ? text('educationStated') || null : null,
      };
    }
    case 'assets':
      return { key, status, movableInr: number('movableInr'), immovableInr: number('immovableInr') };
    case 'cases':
      return { key, status, pending: number('pending'), convictions: number('convictions') };
  }
}

export function errorFor(data: FieldData, inputs: Record<string, string>): FieldError | null {
  if (checkFieldData(data) === null) return null;
  const blank = FIELD_INPUTS[data.key].every((name) => name === 'educationStated' || (inputs[name] ?? '').trim() === '');
  if (data.key === 'gender' || data.key === 'education') return 'choose';
  if (blank || data.key === 'full_name' || data.key === 'party') return 'required';
  if (data.key === 'age' && data.years !== null) return 'age_range';
  return 'whole_number';
}

/** What was posted for one field, as posted, so a refused save can show it back unchanged. */
export interface RawField {
  status: FieldStatus;
  inputs: Record<string, string>;
}

/** Reads one field's status (`status.{key}`) and inputs from a posted form. */
export function readFieldForm(form: FormData, key: AffidavitFieldKey): RawField {
  const raw = String(form.get(`status.${key}`) ?? 'value');
  const inputs: Record<string, string> = {};
  for (const name of FIELD_INPUTS[key]) inputs[name] = String(form.get(name) ?? '');
  return { status: STATUSES.includes(raw as FieldStatus) ? (raw as FieldStatus) : 'value', inputs };
}

/** The structured value stored for `key`, or null when the row has none (never written, or replaced by free text). */
export function storedFieldData(key: AffidavitFieldKey, valueData: unknown): FieldData | null {
  const data = valueData as FieldData | null | undefined;
  return data && data.key === key ? data : null;
}
