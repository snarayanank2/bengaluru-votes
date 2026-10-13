import { describe, it, expect } from 'vitest';
import type { AffidavitExtraction } from '../../src/lib/affidavit-extraction';
import type { GradeResult } from '../../scripts/eval-extraction/grade';
import {
  costUsd,
  languageOf,
  pendingPairs,
  summarize,
  disagreements,
  type ResultRow,
  type ErrorRow,
} from '../../scripts/eval-extraction/report';

const KN = 'test-affidavit-ka2023-kannada-jds-chamrajpet-govindaraj-c.pdf';
const EN = 'test-affidavit-ka2023-english-inc-kr-pura-dk-mohan.pdf';

const extraction: AffidavitExtraction = {
  age: { status: 'value', years: 25 },
  education: { status: 'value', level: 'Graduate', stated: 'B.Com' },
  assets: { status: 'unreadable', totalInr: null, note: 'Page 14 is too faint' },
  cases: { status: 'value', pending: 0, convictions: 0, note: 'States nil' },
  confidence: 60,
};

const gradeResult: GradeResult = {
  scores: {
    age: { outcome: 'wrong', got: 25, expected: 52 },
    educationLevel: { outcome: 'correct', got: 'Graduate', expected: 'Graduate' },
    assetsTotalInr: { outcome: 'abstained', got: null, expected: 1000000 },
    casesPending: { outcome: 'correct', got: 0, expected: 0 },
    casesConvictions: { outcome: 'correct', got: 0, expected: 0 },
  },
  assetsWithin1Percent: null,
};

function row(file: string, model: ResultRow['model']): ResultRow {
  return {
    file,
    model,
    extraction,
    grade: gradeResult,
    usage: { model, inputTokens: 70000, outputTokens: 1000, elapsedMs: 42000, stopReason: 'end_turn' },
    costUsd: costUsd(model, 70000, 1000),
  };
}

describe('costUsd', () => {
  it('prices each model per million tokens', () => {
    expect(costUsd('claude-opus-5-5', 1_000_000, 100_000)).toBeCloseTo(4 + 2, 6);
    expect(costUsd('claude-sonnet-5-5', 1_000_000, 100_000)).toBeCloseTo(2 + 1, 6);
    expect(costUsd('claude-haiku-5-5', 100_000, 10_000)).toBeCloseTo(0.01 + 0.005, 6);
  });

  it('uses the long-prompt Haiku rate above 100,000 input tokens', () => {
    expect(costUsd('claude-haiku-5-5', 200_000, 10_000)).toBeCloseTo(0.1 + 0.025, 6);
  });
});

describe('languageOf', () => {
  it('reads the language from the fixture filename', () => {
    expect(languageOf(KN)).toBe('kannada');
    expect(languageOf(EN)).toBe('english');
    expect(languageOf('other.pdf')).toBe('unknown');
  });
});

describe('pendingPairs', () => {
  it('skips pairs that already have a result and keeps the rest in order', () => {
    const pending = pendingPairs([KN, EN], ['claude-haiku-5-5', 'claude-opus-5-5'], [
      { file: KN, model: 'claude-haiku-5-5' },
    ]);
    expect(pending).toEqual([
      { file: KN, model: 'claude-opus-5-5' },
      { file: EN, model: 'claude-haiku-5-5' },
      { file: EN, model: 'claude-opus-5-5' },
    ]);
  });

  it('returns every pair when nothing is done, so errored pairs are retried', () => {
    expect(pendingPairs([KN], ['claude-haiku-5-5'], [])).toEqual([{ file: KN, model: 'claude-haiku-5-5' }]);
  });
});

describe('summarize', () => {
  const rows = [row(KN, 'claude-haiku-5-5'), row(EN, 'claude-haiku-5-5'), row(KN, 'claude-opus-5-5')];
  const errors: ErrorRow[] = [{ file: EN, model: 'claude-opus-5-5', failure: 'truncated', detail: 'response hit max_tokens' }];
  const text = summarize(rows, errors);

  it('has a row per model with outcome counts and failures', () => {
    // Haiku: 2 affidavits x (3 correct, 1 wrong, 1 abstained); 0 failures.
    expect(text).toMatch(/\| claude-haiku-5-5 \| 2 \| 6 \| 2 \| 2 \| 0 \| 0 \|/);
    // Opus: 1 affidavit scored, 1 failed.
    expect(text).toMatch(/\| claude-opus-5-5 \| 1 \| 3 \| 1 \| 1 \| 0 \| 1 \|/);
  });

  it('has sections by language and per affidavit', () => {
    expect(text).toContain('## By language');
    expect(text).toMatch(/\| kannada \| claude-haiku-5-5 \| 3 \| 1 \| 1 \|/);
    expect(text).toContain('## Per affidavit');
    expect(text).toContain('3/5 (conf 60)');
    expect(text).toContain('FAILED: truncated');
  });
});

describe('disagreements', () => {
  it('lists wrong and abstained values with the note, and nothing correct', () => {
    const text = disagreements([row(KN, 'claude-haiku-5-5')]);
    expect(text).toContain(KN);
    expect(text).toMatch(/age.*got 25.*expected 52/);
    expect(text).toMatch(/assetsTotalInr.*abstained.*expected 1000000/);
    expect(text).toContain('Page 14 is too faint');
    expect(text).not.toMatch(/educationLevel/);
  });

  it('says so when there is nothing to check', () => {
    const clean: ResultRow = { ...row(KN, 'claude-haiku-5-5'), grade: {
      scores: {
        age: { outcome: 'correct', got: 52, expected: 52 },
        educationLevel: { outcome: 'correct', got: 'Graduate', expected: 'Graduate' },
        assetsTotalInr: { outcome: 'correct', got: 1, expected: 1 },
        casesPending: { outcome: 'correct', got: 0, expected: 0 },
        casesConvictions: { outcome: 'correct', got: 0, expected: 0 },
      },
      assetsWithin1Percent: true,
    } };
    expect(disagreements([clean])).toContain('No disagreements');
  });
});
