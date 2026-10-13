/**
 * Pricing, resume logic and markdown reports for the extraction
 * evaluation. Pure: rows in, strings out.
 */
import {
  EXTRACTION_MODELS,
  type AffidavitExtraction,
  type ExtractionFailure,
  type ExtractionModel,
  type ExtractionUsage,
} from '../../src/lib/affidavit-extraction';
import { SCORED_KEYS, type GradeResult, type Outcome, type ScoredKey } from './grade';

export interface ResultRow {
  file: string;
  model: ExtractionModel;
  extraction: AffidavitExtraction;
  grade: GradeResult;
  usage: ExtractionUsage;
  costUsd: number;
}

export interface ErrorRow {
  file: string;
  model: ExtractionModel;
  failure: ExtractionFailure;
  detail: string;
  usage?: ExtractionUsage;
}

export interface Pair {
  file: string;
  model: ExtractionModel;
}

/**
 * US dollars per million tokens, Anthropic first-party rates as of
 * 2026-10-06. Reasoning tokens are billed as output and are already inside
 * `output_tokens`. Haiku 5.5 has a higher rate for prompts over 100,000
 * tokens; this assumes the whole request is billed at that rate, which is
 * the more expensive reading of the price list.
 */
const PRICES: Record<ExtractionModel, { input: number; output: number; long?: { input: number; output: number } }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, long: { input: 0.5, output: 2.5 } },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};
const LONG_PROMPT_TOKENS = 100_000;

export function costUsd(model: ExtractionModel, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model];
  const rate = price.long && inputTokens > LONG_PROMPT_TOKENS ? price.long : price;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

export function languageOf(file: string): 'kannada' | 'english' | 'unknown' {
  if (file.includes('-kannada-')) return 'kannada';
  if (file.includes('-english-')) return 'english';
  return 'unknown';
}

/**
 * Every (file, model) pair without a saved result, files outermost. Pairs
 * that only ever produced an error row are not in `done`, so they are
 * retried on the next run.
 */
export function pendingPairs(files: string[], models: readonly ExtractionModel[], done: Pair[]): Pair[] {
  const finished = new Set(done.map((p) => `${p.file}\n${p.model}`));
  const pending: Pair[] = [];
  for (const file of files) {
    for (const model of models) {
      if (!finished.has(`${file}\n${model}`)) pending.push({ file, model });
    }
  }
  return pending;
}

/** A row saved before a scored key existed has no score for it; such a value is simply not counted. */
function scoreOf(row: ResultRow, key: ScoredKey) {
  return row.grade.scores[key] as GradeResult['scores'][ScoredKey] | undefined;
}

function tally(rows: ResultRow[]): Record<Outcome, number> {
  const counts: Record<Outcome, number> = { correct: 0, wrong: 0, abstained: 0, unscored: 0 };
  for (const row of rows) {
    for (const key of SCORED_KEYS) {
      const s = scoreOf(row, key);
      if (s) counts[s.outcome] += 1;
    }
  }
  return counts;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Tokens and cost of the failed calls for one model that reported usage. */
function failedBilled(model: ExtractionModel, errors: ErrorRow[]): { input: number; output: number; cost: number } {
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const e of errors) {
    if (e.model !== model || !e.usage) continue;
    input += e.usage.inputTokens;
    output += e.usage.outputTokens;
    cost += costUsd(model, e.usage.inputTokens, e.usage.outputTokens);
  }
  return { input, output, cost };
}

export function summarize(rows: ResultRow[], errors: ErrorRow[]): string {
  const models = EXTRACTION_MODELS.filter(
    (m) => rows.some((r) => r.model === m) || errors.some((e) => e.model === m),
  );
  const lines: string[] = ['# Extraction evaluation summary', ''];

  lines.push('## By model', '');
  lines.push('Tokens and cost include failed attempts that reported usage.', '');
  lines.push('| Model | Affidavits scored | Correct | Wrong | Abstained | Unscored | Failed attempts | Pairs still failing | Assets within 1% | Input tokens | Output tokens | Cost (USD) | Mean seconds (successful calls) |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const resolved = new Set(rows.map((r) => `${r.file}\n${r.model}`));
  for (const model of models) {
    const mine = rows.filter((r) => r.model === model);
    const t = tally(mine);
    const attempts = errors.filter((e) => e.model === model);
    const failed = attempts.length;
    const stillFailing = new Set(
      attempts.filter((e) => !resolved.has(`${e.file}\n${e.model}`)).map((e) => e.file),
    ).size;
    const extra = failedBilled(model, errors);
    const within = mine.filter((r) => r.grade.assetsWithin1Percent === true).length;
    const withAssets = mine.filter((r) => r.grade.assetsWithin1Percent !== null).length;
    const seconds = mine.length ? sum(mine.map((r) => r.usage.elapsedMs)) / mine.length / 1000 : 0;
    const inputTokens = sum(mine.map((r) => r.usage.inputTokens)) + extra.input;
    const outputTokens = sum(mine.map((r) => r.usage.outputTokens)) + extra.output;
    const cost = sum(mine.map((r) => r.costUsd)) + extra.cost;
    lines.push(
      `| ${model} | ${mine.length} | ${t.correct} | ${t.wrong} | ${t.abstained} | ${t.unscored} | ${failed} | ${stillFailing} | ` +
        `${within}/${withAssets} | ${inputTokens} | ${outputTokens} | ${cost.toFixed(2)} | ${seconds.toFixed(0)} |`,
    );
  }

  lines.push('', '## By language', '');
  lines.push('| Language | Model | Correct | Wrong | Abstained | Unscored | Input tokens | Cost (USD) | Mean seconds |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const language of ['kannada', 'english', 'unknown'] as const) {
    for (const model of models) {
      const mine = rows.filter((r) => r.model === model && languageOf(r.file) === language);
      if (mine.length === 0) continue;
      const t = tally(mine);
      const inputTokens = sum(mine.map((r) => r.usage.inputTokens));
      const cost = sum(mine.map((r) => r.costUsd));
      const seconds = sum(mine.map((r) => r.usage.elapsedMs)) / mine.length / 1000;
      lines.push(
        `| ${language} | ${model} | ${t.correct} | ${t.wrong} | ${t.abstained} | ${t.unscored} | ` +
          `${inputTokens} | ${cost.toFixed(2)} | ${seconds.toFixed(0)} |`,
      );
    }
  }

  lines.push('', '## By field', '');
  lines.push('| Model | Field | Correct | Wrong | Abstained | Unscored |');
  lines.push('|---|---|---|---|---|---|');
  for (const model of models) {
    const mine = rows.filter((r) => r.model === model);
    for (const key of SCORED_KEYS) {
      const counts: Record<Outcome, number> = { correct: 0, wrong: 0, abstained: 0, unscored: 0 };
      for (const r of mine) {
        const s = scoreOf(r, key);
        if (s) counts[s.outcome] += 1;
      }
      if (counts.correct + counts.wrong + counts.abstained + counts.unscored === 0) continue;
      lines.push(`| ${model} | ${key} | ${counts.correct} | ${counts.wrong} | ${counts.abstained} | ${counts.unscored} |`);
    }
  }

  lines.push('', '## Per affidavit', '');
  lines.push("One row per affidavit and model. Confidence is the model's own figure.", '');
  lines.push('| Affidavit | Model | Correct | Wrong | Abstained | Confidence | Input tokens | Output tokens | Cost (USD) | Seconds |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  const files = [...new Set([...rows.map((r) => r.file), ...errors.map((e) => e.file)])].sort();
  for (const file of files) {
    for (const model of models) {
      const row = rows.find((r) => r.file === file && r.model === model);
      if (row) {
        const t = tally([row]);
        lines.push(
          `| ${file} | ${model} | ${t.correct} | ${t.wrong} | ${t.abstained} | ${row.extraction.confidence} | ` +
            `${row.usage.inputTokens} | ${row.usage.outputTokens} | ${row.costUsd.toFixed(3)} | ` +
            `${(row.usage.elapsedMs / 1000).toFixed(0)} |`,
        );
        continue;
      }
      const error = errors.filter((e) => e.file === file && e.model === model).at(-1);
      if (!error) continue;
      const tokens = error.usage
        ? [
            `${error.usage.inputTokens}`,
            `${error.usage.outputTokens}`,
            costUsd(model, error.usage.inputTokens, error.usage.outputTokens).toFixed(3),
          ]
        : ['', '', ''];
      const cells = [file, model, `FAILED: ${error.failure}`, '', '', '', ...tokens, ''];
      lines.push('|' + cells.map((c) => (c === '' ? ' |' : ` ${c} |`)).join(''));
    }
  }

  return lines.join('\n') + '\n';
}

const NOTE_FOR: Record<ScoredKey, (e: AffidavitExtraction) => string | null> = {
  age: () => null,
  educationLevel: (e) => e.education.stated,
  assetsTotalInr: (e) => e.assets.note,
  casesPending: (e) => e.cases.note,
  casesConvictions: (e) => e.cases.note,
  name: () => null,
  party: () => null,
  gender: () => null,
};

export function disagreements(rows: ResultRow[]): string {
  const lines: string[] = [
    '# Values to check against the PDFs',
    '',
    'Each line is a value where a model differs from `expected.json`, abstained, or needed the cases exception.',
    '',
  ];
  let count = 0;
  const files = [...new Set(rows.map((r) => r.file))].sort();
  for (const file of files) {
    const items: string[] = [];
    const mine = rows.filter((r) => r.file === file);
    const ordered = EXTRACTION_MODELS.flatMap((m) => mine.filter((r) => r.model === m));
    for (const row of ordered) {
      for (const key of SCORED_KEYS) {
        const s = scoreOf(row, key);
        if (!s) continue;
        if (s.outcome === 'correct' && !s.flag) continue;
        if (s.outcome === 'unscored') continue;
        const what =
          s.outcome === 'abstained'
            ? `abstained, expected ${s.expected}`
            : s.flag
              ? `not declared, counted as the expected ${s.expected}`
              : `got ${s.got}, expected ${s.expected}`;
        const note = NOTE_FOR[key](row.extraction);
        items.push(`- ${key} (${row.model}): ${what}${note ? `. Note: ${note}` : ''}`);
        count += 1;
      }
    }
    if (items.length > 0) lines.push(`## ${file}`, '', ...items, '');
  }
  if (count === 0) lines.push('No disagreements.', '');
  return lines.join('\n');
}
