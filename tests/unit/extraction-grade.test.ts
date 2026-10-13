import { describe, it, expect } from 'vitest';
import type { AffidavitExtraction } from '../../src/lib/affidavit-extraction';
import { grade, type ExpectedEntry } from '../../scripts/eval-extraction/grade';

function extraction(): AffidavitExtraction {
  return {
    age: { status: 'value', years: 52 },
    education: { status: 'value', level: 'Graduate', stated: 'B.Com' },
    assets: { status: 'value', totalInr: 1000000, note: null },
    cases: { status: 'value', pending: 2, convictions: 0, note: null },
    confidence: 80,
  };
}

function expected(): ExpectedEntry {
  return {
    age: 52,
    educationLevel: 'Graduate',
    assetsTotalInr: 1000000,
    casesPending: 2,
    casesConvictions: 0,
    sourceUrl: 'https://myneta.info/Karnataka2023/candidate.php?candidate_id=1',
    retrievedOn: '2026-10-13',
    verifiedBy: {
      age: 'myneta',
      educationLevel: 'myneta',
      assetsTotalInr: 'myneta',
      casesPending: 'myneta',
      casesConvictions: 'myneta',
    },
  };
}

describe('grade', () => {
  it('marks every value correct on an exact match', () => {
    const result = grade(extraction(), expected());
    expect(Object.values(result.scores).map((s) => s.outcome)).toEqual([
      'correct', 'correct', 'correct', 'correct', 'correct',
    ]);
    expect(result.assetsWithin1Percent).toBe(true);
  });

  it('marks a differing value wrong and records both sides', () => {
    const e = extraction();
    e.age.years = 25;
    expect(grade(e, expected()).scores.age).toEqual({ outcome: 'wrong', got: 25, expected: 52 });
  });

  it('marks unreadable as abstained', () => {
    const e = extraction();
    e.assets = { status: 'unreadable', totalInr: null, note: null };
    const result = grade(e, expected());
    expect(result.scores.assetsTotalInr.outcome).toBe('abstained');
    expect(result.assetsWithin1Percent).toBeNull();
  });

  it('marks not_declared wrong where a value is expected', () => {
    const e = extraction();
    e.education = { status: 'not_declared', level: null, stated: null };
    expect(grade(e, expected()).scores.educationLevel.outcome).toBe('wrong');
  });

  it('treats not_declared cases as an expected zero and flags it', () => {
    const e = extraction();
    e.cases = { status: 'not_declared', pending: null, convictions: null, note: null };
    const x = expected();
    x.casesPending = 0;
    const result = grade(e, x);
    expect(result.scores.casesPending).toEqual({
      outcome: 'correct', got: null, expected: 0, flag: 'not_declared_as_zero',
    });
    expect(result.scores.casesConvictions.flag).toBe('not_declared_as_zero');
  });

  it('marks not_declared cases wrong where a non-zero count is expected', () => {
    const e = extraction();
    e.cases = { status: 'not_declared', pending: null, convictions: null, note: null };
    expect(grade(e, expected()).scores.casesPending.outcome).toBe('wrong');
  });

  it('leaves a field with no expected value unscored', () => {
    const x = expected();
    x.age = null;
    expect(grade(extraction(), x).scores.age).toEqual({ outcome: 'unscored', got: 52, expected: null });
  });

  it('reports assets within 1% separately from exact match', () => {
    const e = extraction();
    e.assets.totalInr = 1005000;
    const result = grade(e, expected());
    expect(result.scores.assetsTotalInr.outcome).toBe('wrong');
    expect(result.assetsWithin1Percent).toBe(true);
    e.assets.totalInr = 1200000;
    expect(grade(e, expected()).assetsWithin1Percent).toBe(false);
  });

  it('handles expected assets of zero without dividing by zero', () => {
    const x = expected();
    x.assetsTotalInr = 0;
    const e = extraction();
    e.assets.totalInr = 0;
    expect(grade(e, x).assetsWithin1Percent).toBe(true);
    e.assets.totalInr = 10;
    expect(grade(e, x).assetsWithin1Percent).toBe(false);
  });
});
