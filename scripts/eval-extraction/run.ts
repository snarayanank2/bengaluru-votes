#!/usr/bin/env tsx
/**
 * Affidavit extraction evaluation. MAKES PAID API CALLS in --pilot and
 * --full modes; never run from `npm test`.
 *
 *   npm run eval:extraction                          # print the plan, no API call
 *   npm run eval:extraction -- --pilot               # 1 affidavit x 3 models
 *   npm run eval:extraction -- --full --out <dir>    # every pending pair
 *   npm run eval:extraction -- --regrade <dir>       # rescore, no API call
 *
 * Needs ANTHROPIC_API_KEY in the environment for --pilot and --full.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { EXTRACTION_MODELS, extractAffidavit } from '../../src/lib/affidavit-extraction';
import { expectedFileSchema, grade } from './grade';
import { costUsd, disagreements, pendingPairs, summarize, type ErrorRow, type Pair, type ResultRow } from './report';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const fixturesDir = path.join(repoRoot, 'tests/fixtures/affidavits');
const CONCURRENCY = 3;

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as T);
}

function loadExpected() {
  return expectedFileSchema.parse(JSON.parse(readFileSync(path.join(fixturesDir, 'expected.json'), 'utf8')));
}

function fixtureFiles(): string[] {
  return readdirSync(fixturesDir).filter((f) => f.endsWith('.pdf')).sort();
}

async function runPairs(pairs: Pair[], outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const expected = loadExpected();
  const client = new Anthropic();
  const queue = [...pairs];

  async function worker(): Promise<void> {
    for (let pair = queue.shift(); pair; pair = queue.shift()) {
      const { file, model } = pair;
      const outcome = await extractAffidavit(readFileSync(path.join(fixturesDir, file)), model, client);
      if (outcome.ok) {
        const row: ResultRow = {
          file,
          model,
          extraction: outcome.extraction,
          grade: grade(outcome.extraction, expected[file]),
          usage: outcome.usage,
          costUsd: costUsd(model, outcome.usage.inputTokens, outcome.usage.outputTokens),
        };
        appendFileSync(path.join(outDir, 'results.jsonl'), JSON.stringify(row) + '\n');
        console.log(`ok      ${model}  ${file}  ${outcome.usage.inputTokens} in / ${outcome.usage.outputTokens} out  $${row.costUsd.toFixed(3)}`);
      } else {
        const row: ErrorRow = { file, model, failure: outcome.failure, detail: outcome.detail, usage: outcome.usage };
        appendFileSync(path.join(outDir, 'errors.jsonl'), JSON.stringify(row) + '\n');
        console.log(`FAILED  ${model}  ${file}  ${outcome.failure}: ${outcome.detail}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
}

/** Errors for pairs that later succeeded on a rerun are stale; drop them. */
function liveErrors(rows: ResultRow[], errors: ErrorRow[]): ErrorRow[] {
  const done = new Set(rows.map((r) => `${r.file}\n${r.model}`));
  const latest = new Map<string, ErrorRow>();
  for (const e of errors) {
    const key = `${e.file}\n${e.model}`;
    if (!done.has(key)) latest.set(key, e);
  }
  return [...latest.values()];
}

function writeReports(outDir: string, suffix = ''): void {
  const rows = readJsonl<ResultRow>(path.join(outDir, 'results.jsonl'));
  const errors = liveErrors(rows, readJsonl<ErrorRow>(path.join(outDir, 'errors.jsonl')));
  writeFileSync(path.join(outDir, `summary${suffix}.md`), summarize(rows, errors));
  writeFileSync(path.join(outDir, `disagreements${suffix}.md`), disagreements(rows));
  console.log(`\nWrote summary${suffix}.md and disagreements${suffix}.md to ${outDir}`);
}

function requireKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set.');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valueOf = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const files = fixtureFiles();

  if (args.includes('--regrade')) {
    const dir = valueOf('--regrade');
    if (!dir) throw new Error('--regrade needs a run directory');
    const expected = loadExpected();
    const rows = readJsonl<ResultRow>(path.join(dir, 'results.jsonl')).map((row) => ({
      ...row,
      grade: grade(row.extraction, expected[row.file]),
    }));
    writeFileSync(path.join(dir, 'results-regraded.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const errors = liveErrors(rows, readJsonl<ErrorRow>(path.join(dir, 'errors.jsonl')));
    writeFileSync(path.join(dir, 'summary-regraded.md'), summarize(rows, errors));
    writeFileSync(path.join(dir, 'disagreements-regraded.md'), disagreements(rows));
    console.log(`Regraded ${rows.length} results in ${dir}`);
    return;
  }

  if (args.includes('--pilot')) {
    requireKey();
    const outDir = valueOf('--out') ?? path.join(repoRoot, 'eval-runs', `pilot-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await runPairs(pendingPairs([files[0]], EXTRACTION_MODELS, []), outDir);
    const rows = readJsonl<ResultRow>(path.join(outDir, 'results.jsonl'));
    const pilotBytes = readFileSync(path.join(fixturesDir, files[0])).length;
    const restBytes = files.slice(1).reduce((n, f) => n + readFileSync(path.join(fixturesDir, f)).length, 0);
    console.log('\nProjection for the remaining affidavits, scaled by file size from the pilot:');
    let total = 0;
    for (const row of rows) {
      const projected = row.costUsd * (restBytes / pilotBytes);
      total += projected;
      console.log(`  ${row.model}: pilot $${row.costUsd.toFixed(3)} (${row.usage.inputTokens} in / ${row.usage.outputTokens} out, ${(row.usage.elapsedMs / 1000).toFixed(0)}s); remaining about $${projected.toFixed(2)}`);
    }
    console.log(`  Total remaining: about $${total.toFixed(2)}`);
    console.log(`\nPilot results are in ${outDir}. To continue into the same directory:\n  npm run eval:extraction -- --full --out ${outDir}`);
    return;
  }

  if (args.includes('--full')) {
    requireKey();
    const outDir = valueOf('--out');
    if (!outDir) throw new Error('--full needs --out <dir>');
    const done = readJsonl<ResultRow>(path.join(outDir, 'results.jsonl'));
    const pending = pendingPairs(files, EXTRACTION_MODELS, done);
    console.log(`${done.length} results already saved; running ${pending.length} calls.`);
    await runPairs(pending, outDir);
    writeReports(outDir);
    return;
  }

  const pairs = pendingPairs(files, EXTRACTION_MODELS, []);
  console.log(`Plan: ${files.length} affidavits x ${EXTRACTION_MODELS.length} models = ${pairs.length} calls. No API call made.`);
  for (const { file, model } of pairs) console.log(`  ${model}  ${file}`);
  console.log('\nRun with --pilot to make the first three calls.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
