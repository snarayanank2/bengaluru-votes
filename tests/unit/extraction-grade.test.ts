import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AffidavitExtraction } from '../../src/lib/affidavit-extraction';
import { grade, normalizeName, normalizeParty, expectedFileSchema, type ExpectedEntry } from '../../scripts/eval-extraction/grade';

function extraction(): AffidavitExtraction {
  return {
    age: { status: 'value', years: 52 },
    education: { status: 'value', level: 'Graduate', stated: 'B.Com' },
    assets: { status: 'value', movableInr: 0, immovableInr: 1000000, totalInr: 1000000, note: null },
    cases: { status: 'value', pending: 2, convictions: 0, note: null },
    identity: {
      name: { status: 'value', text: 'Govindaraj C' },
      ward: { status: 'not_declared', number: null, name: null, corporation: null },
      party: { status: 'value', text: 'Janata Dal (Secular)' },
      gender: { status: 'value', gender: 'male' },
    },
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
      'correct', 'correct', 'correct', 'correct', 'correct', 'unscored', 'unscored', 'unscored',
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
    e.assets = { status: 'unreadable', movableInr: null, immovableInr: null, totalInr: null, note: null };
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

describe('identity grading', () => {
  it('ignores case, punctuation and word order in names', () => {
    expect(normalizeName('C.Govindaraj')).toBe(normalizeName('govindaraj c'));
    expect(normalizeName('B. A. Basavaraja')).not.toBe(normalizeName('BA Basavaraj'));
  });

  it('treats a party abbreviation and its full name as the same party', () => {
    expect(normalizeParty('JD(S)')).toBe(normalizeParty('Janata Dal (Secular)'));
    expect(normalizeParty('BJP')).toBe(normalizeParty('Bharatiya Janata Party'));
    expect(normalizeParty('INC')).not.toBe(normalizeParty('AAP'));
  });

  it('scores name, party and gender when expected values exist', () => {
    const x = { ...expected(), name: 'C.Govindaraj', party: 'JD(S)', gender: 'male' as const };
    const { scores } = grade(extraction(), x);
    expect(scores.name.outcome).toBe('correct');
    expect(scores.party.outcome).toBe('correct');
    expect(scores.gender.outcome).toBe('correct');
  });

  it('marks a different name wrong and an unreadable one abstained', () => {
    const x = { ...expected(), name: 'Someone Else' };
    expect(grade(extraction(), x).scores.name.outcome).toBe('wrong');
    const e = extraction();
    e.identity.name = { status: 'unreadable', text: null };
    expect(grade(e, x).scores.name.outcome).toBe('abstained');
  });

  it('leaves identity unscored for a saved result that predates it', () => {
    const { identity: _dropped, ...old } = extraction();
    const x = { ...expected(), name: 'C.Govindaraj' };
    expect(grade(old as AffidavitExtraction, x).scores.name.outcome).toBe('unscored');
  });
});

describe('expected.json', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/affidavits');

  it('has a valid entry for every fixture PDF and nothing else', () => {
    const pdfs = readdirSync(dir).filter((f) => f.endsWith('.pdf')).sort();
    const parsed = expectedFileSchema.parse(JSON.parse(readFileSync(path.join(dir, 'expected.json'), 'utf8')));
    expect(Object.keys(parsed).sort()).toEqual(pdfs);
    expect(pdfs).toHaveLength(9);
  });

  it('gives a reason for every value Siva overruled', () => {
    const parsed = expectedFileSchema.parse(JSON.parse(readFileSync(path.join(dir, 'expected.json'), 'utf8')));
    for (const [file, entry] of Object.entries(parsed)) {
      for (const [key, who] of Object.entries(entry.verifiedBy)) {
        if (who === 'siva') expect(entry.reasons?.[key], `${file} ${key}`).toBeTruthy();
      }
    }
  });
});
