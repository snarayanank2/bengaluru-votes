/**
 * The `data-flag-targets` JSON a "Flag an error" button carries for one
 * candidate: the eight flaggable fields, then "Other" (architecture §7). The
 * same markup renders for every visitor (public pages never vary by session).
 */
import { t, type Lang } from '../i18n';
import { CANDIDATE_PROFILE_LABEL_KEYS, FLAGGABLE_FIELD_KEYS } from './candidate-profile';
import { OTHER_TARGET_KEY } from './flags';

export function flagTargetsJson(lang: Lang, candidateId: number): string {
  return JSON.stringify([
    ...FLAGGABLE_FIELD_KEYS.map((key) => ({
      targetType: 'candidate_field',
      targetRef: `candidate:${candidateId}:${key}`,
      label: t(lang, CANDIDATE_PROFILE_LABEL_KEYS[key]),
    })),
    { targetType: 'candidate_other', targetRef: `candidate:${candidateId}:${OTHER_TARGET_KEY}`, label: t(lang, 'flag.modal.otherLabel') },
  ]);
}
