import type { Lang } from '../i18n';

export const CANDIDATE_PROFILE_FIELD_KEYS = [
  'full_name',
  'ward',
  'party',
  'gender',
  'age',
  'education',
  'assets',
  'cases',
  'ec_affidavit',
] as const;

export type CandidateProfileFieldKey = (typeof CANDIDATE_PROFILE_FIELD_KEYS)[number];

export const CANDIDATE_PROFILE_LABEL_KEYS: Record<CandidateProfileFieldKey, string> = {
  full_name: 'candidate.field.fullName',
  ward: 'candidate.field.ward',
  party: 'candidate.field.partyName',
  gender: 'candidate.field.gender',
  age: 'candidate.field.age',
  education: 'candidate.field.education',
  assets: 'candidate.field.assets',
  cases: 'candidate.field.cases',
  ec_affidavit: 'candidate.field.ecAffidavit',
};

export function pickCandidateValue(
  lang: Lang,
  valueEn: string | null | undefined,
  valueKn: string | null | undefined,
): string | null {
  return (lang === 'kn' ? (valueKn ?? valueEn) : (valueEn ?? valueKn)) ?? null;
}
