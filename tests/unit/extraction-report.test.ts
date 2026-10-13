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
  assets: { status: 'unreadable', movableInr: null, immovableInr: null, totalInr: null, note: 'Page 14 is too faint' },
  cases: { status: 'value', pending: 0, convictions: 0, note: 'States nil' },
  identity: {
    name: { status: 'value', text: 'Govindaraj C' },
    ward: { status: 'not_declared', number: null, name: null, corporation: null },
    party: { status: 'value', text: 'JD(S)' },
    gender: { status: 'not_declared', gender: null },
  },
  confidence: 60,
};

const unscoredIdentity = {
  name: { outcome: 'unscored', got: 'Govindaraj C', expected: null },
  party: { outcome: 'unscored', got: 'JD(S)', expected: null },
  gender: { outcome: 'unscored', got: null, expected: null },
} as const;

const gradeResult: GradeResult = {
  scores: {
    age: { outcome: 'wrong', got: 25, expected: 52 },
    educationLevel: { outcome: 'correct', got: 'Graduate', expected: 'Graduate' },
    assetsTotalInr: { outcome: 'abstained', got: null, expected: 1000000 },
    casesPending: { outcome: 'correct', got: 0, expected: 0 },
    casesConvictions: { outcome: 'correct', got: 0, expected: 0 },
    ...unscoredIdentity,
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
    // Haiku: 2 affidavits x (3 correct, 1 wrong, 1 abstained); 0 failed attempts, 0 pairs still failing.
    expect(text).toMatch(/\| claude-haiku-5-5 \| 2 \| 6 \| 2 \| 2 \| 6 \| 0 \| 0 \|/);
    // Opus: 1 affidavit scored, 1 failed attempt, 1 pair still failing.
    expect(text).toMatch(/\| claude-opus-5-5 \| 1 \| 3 \| 1 \| 1 \| 3 \| 1 \| 1 \|/);
  });

  it('has sections by language and per affidavit', () => {
    expect(text).toContain('## By language');
    expect(text).toMatch(/\| kannada \| claude-haiku-5-5 \| 3 \| 1 \| 1 \| 3 \| 70000 \| 0\.01 \| 42 \|/);
    expect(text).toContain('## Per affidavit');
    expect(text).toContain('FAILED: truncated');
  });

  it('shows each result row per affidavit with counts, confidence, tokens, cost and seconds', () => {
    expect(text).toContain(`| ${KN} | claude-haiku-5-5 | 3 | 1 | 1 | 60 | 70000 | 1000 | 0.007 | 42 |`);
    expect(text).toContain(`| ${EN} | claude-opus-5-5 | FAILED: truncated | | | | | | | |`);
  });
});

describe('summarize with failed calls that reported usage', () => {
  const failedWithUsage: ErrorRow = {
    file: EN,
    model: 'claude-opus-5-5',
    failure: 'truncated',
    detail: 'response hit max_tokens',
    usage: { model: 'claude-opus-5-5', inputTokens: 50000, outputTokens: 16000, elapsedMs: 90000, stopReason: 'max_tokens' },
  };
  const text = summarize([row(KN, 'claude-opus-5-5')], [failedWithUsage]);

  it('adds the failed call tokens and cost to the model totals, but not to the seconds mean', () => {
    // Result row: 70000 in, 1000 out, $0.30. Failed call: 50000 in, 16000 out, $0.52.
    expect(text).toMatch(/\| claude-opus-5-5 \| 1 \| 3 \| 1 \| 1 \| 3 \| 1 \| 1 \| 0\/0 \| 120000 \| 17000 \| 0\.82 \| 42 \|/);
  });

  it('shows the failed call tokens and cost on its per-affidavit row', () => {
    expect(text).toContain(`| ${EN} | claude-opus-5-5 | FAILED: truncated | | | | 50000 | 16000 | 0.520 | |`);
  });
});

describe('summarize with retries', () => {
  const usage = { model: 'claude-opus-5-5' as const, inputTokens: 50000, outputTokens: 16000, elapsedMs: 90000, stopReason: 'max_tokens' };

  it('counts a failed attempt for a pair that later succeeded, with its tokens and cost, but no FAILED row', () => {
    const text = summarize([row(KN, 'claude-opus-5-5')], [
      { file: KN, model: 'claude-opus-5-5', failure: 'truncated', detail: 'x', usage },
    ]);
    expect(text).toContain('| Failed attempts | Pairs still failing |');
    expect(text).toMatch(/\| claude-opus-5-5 \| 1 \| 3 \| 1 \| 1 \| 3 \| 1 \| 0 \| 0\/0 \| 120000 \| 17000 \| 0\.82 \| 42 \|/);
    expect(text).not.toContain('FAILED');
  });

  it('counts two errors for one unresolved pair as 2 attempts and 1 pair, showing the last failure', () => {
    const text = summarize([row(KN, 'claude-haiku-5-5')], [
      { file: EN, model: 'claude-opus-5-5', failure: 'truncated', detail: 'first' },
      { file: EN, model: 'claude-opus-5-5', failure: 'invalid_output', detail: 'second' },
    ]);
    expect(text).toMatch(/\| claude-opus-5-5 \| 0 \| 0 \| 0 \| 0 \| 0 \| 2 \| 1 \|/);
    expect(text).toContain(`| ${EN} | claude-opus-5-5 | FAILED: invalid_output |`);
    expect(text).not.toContain('FAILED: truncated');
  });
});

describe('summarize by field', () => {
  const text = summarize([row(KN, 'claude-haiku-5-5'), row(EN, 'claude-haiku-5-5')], []);

  it('has a section between language and per affidavit', () => {
    expect(text.indexOf('## By language')).toBeLessThan(text.indexOf('## By field'));
    expect(text.indexOf('## By field')).toBeLessThan(text.indexOf('## Per affidavit'));
    expect(text).toContain('| Model | Field | Correct | Wrong | Abstained | Unscored |');
  });

  it('counts per model and key over that model result rows', () => {
    // Fixture grade: age wrong, educationLevel correct, two rows each.
    expect(text).toContain('| claude-haiku-5-5 | age | 0 | 2 | 0 | 0 |');
    expect(text).toContain('| claude-haiku-5-5 | educationLevel | 2 | 0 | 0 | 0 |');
  });
});

describe('summarize for a model with only failed calls', () => {
  const text = summarize(
    [row(KN, 'claude-haiku-5-5')],
    [{ file: EN, model: 'claude-opus-5-5', failure: 'api_error', detail: 'boom' }],
  );

  it('still gets a by-model row with zero scored, one failed call and zero seconds, and no NaN', () => {
    expect(text).toMatch(/\| claude-opus-5-5 \| 0 \| 0 \| 0 \| 0 \| 0 \| 1 \| 1 \| 0\/0 \| 0 \| 0 \| 0\.00 \| 0 \|/);
    expect(text).not.toContain('NaN');
  });
});

describe('disagreements', () => {
  it('orders lines within a file by model order, not arrival order', () => {
    const text = disagreements([row(KN, 'claude-opus-5-5'), row(KN, 'claude-haiku-5-5')]);
    expect(text.indexOf('(claude-haiku-5-5)')).toBeGreaterThan(-1);
    expect(text.indexOf('(claude-haiku-5-5)')).toBeLessThan(text.indexOf('(claude-opus-5-5)'));
  });

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
        ...unscoredIdentity,
      },
      assetsWithin1Percent: true,
    } };
    expect(disagreements([clean])).toContain('No disagreements');
  });
});
