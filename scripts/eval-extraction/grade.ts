/**
 * Pure grading for the affidavit extraction evaluation: one extraction and
 * one expected entry in, five scored values out. No I/O.
 */
import * as z from 'zod/v4';
import { EDUCATION_LEVELS, type AffidavitExtraction } from '../../src/lib/affidavit-extraction';

export const SCORED_KEYS = ['age', 'educationLevel', 'assetsTotalInr', 'casesPending', 'casesConvictions'] as const;
export type ScoredKey = (typeof SCORED_KEYS)[number];

/** `unscored`: there is no expected value, so the model is not judged on it. */
export type Outcome = 'correct' | 'wrong' | 'abstained' | 'unscored';

const verifier = z.enum(['myneta', 'siva']);

export const expectedEntrySchema = z.strictObject({
  age: z.number().int().nullable(),
  educationLevel: z.enum(EDUCATION_LEVELS).nullable(),
  assetsTotalInr: z.number().int().nullable(),
  casesPending: z.number().int().nullable(),
  casesConvictions: z.number().int().nullable(),
  sourceUrl: z.string(),
  retrievedOn: z.string(),
  verifiedBy: z.strictObject({
    age: verifier,
    educationLevel: verifier,
    assetsTotalInr: verifier,
    casesPending: verifier,
    casesConvictions: verifier,
  }),
  /** One line per value Siva overruled, keyed by scored key. */
  reasons: z.record(z.string(), z.string()).optional(),
});
export type ExpectedEntry = z.infer<typeof expectedEntrySchema>;

/** `expected.json`: PDF filename -> entry. */
export const expectedFileSchema = z.record(z.string(), expectedEntrySchema);

export interface Score {
  outcome: Outcome;
  got: number | string | null;
  expected: number | string | null;
  flag?: 'not_declared_as_zero';
}

export interface GradeResult {
  scores: Record<ScoredKey, Score>;
  /** null when either side has no assets figure. */
  assetsWithin1Percent: boolean | null;
}

type Status = AffidavitExtraction['age']['status'];

function score(
  status: Status,
  got: number | string | null,
  expected: number | string | null,
  isCases = false,
): Score {
  if (expected === null) return { outcome: 'unscored', got, expected };
  if (status === 'unreadable') return { outcome: 'abstained', got, expected };
  if (status === 'not_declared') {
    if (isCases && expected === 0) return { outcome: 'correct', got, expected, flag: 'not_declared_as_zero' };
    return { outcome: 'wrong', got, expected };
  }
  return { outcome: got === expected ? 'correct' : 'wrong', got, expected };
}

export function grade(extraction: AffidavitExtraction, expected: ExpectedEntry): GradeResult {
  const { age, education, assets, cases } = extraction;

  let assetsWithin1Percent: boolean | null = null;
  if (assets.totalInr !== null && expected.assetsTotalInr !== null) {
    const difference = Math.abs(assets.totalInr - expected.assetsTotalInr);
    assetsWithin1Percent = difference <= expected.assetsTotalInr * 0.01;
  }

  return {
    scores: {
      age: score(age.status, age.years, expected.age),
      educationLevel: score(education.status, education.level, expected.educationLevel),
      assetsTotalInr: score(assets.status, assets.totalInr, expected.assetsTotalInr),
      casesPending: score(cases.status, cases.pending, expected.casesPending, true),
      casesConvictions: score(cases.status, cases.convictions, expected.casesConvictions, true),
    },
    assetsWithin1Percent,
  };
}
