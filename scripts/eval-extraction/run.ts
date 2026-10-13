#!/usr/bin/env tsx
/**
 * Affidavit extraction evaluation. MAKES PAID API CALLS in --pilot and
 * --full modes; never run from `npm test`.
 *
 *   npm run eval:extraction                          # print the plan, no API call
 *   npm run eval:extraction -- --pilot               # 1 affidavit x 3 models
 *   npm run eval:extraction -- --full --out <dir>    # every pending pair
 *   npm run eval:extraction -- --regrade <dir>       # rescore, no API call
 *   add --model <id> to a pilot or full run to use one model only
 *
 * Needs ANTHROPIC_API_KEY in the environment for --pilot and --full.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { EXTRACTION_MODELS, extractAffidavit, type ExtractionModel } from '../../src/lib/affidavit-extraction';
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

/** Returns true if any pair threw unexpectedly; those pairs write nothing and are retried on the next run. */
async function runPairs(pairs: Pair[], outDir: string): Promise<boolean> {
  const expected = loadExpected();
  for (const { file } of pairs) {
    if (expected[file] === undefined) throw new Error(`expected.json has no entry for ${file}`);
  }
  mkdirSync(outDir, { recursive: true });
  const client = new Anthropic();
  const queue = [...pairs];
  let hadUnexpectedError = false;

  async function worker(): Promise<void> {
    for (let pair = queue.shift(); pair; pair = queue.shift()) {
      const { file, model } = pair;
      try {
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
      } catch (err) {
        hadUnexpectedError = true;
        console.log(`ERROR   ${model}  ${file}  ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return hadUnexpectedError;
}

function writeReports(outDir: string): void {
  const rows = readJsonl<ResultRow>(path.join(outDir, 'results.jsonl'));
  const errors = readJsonl<ErrorRow>(path.join(outDir, 'errors.jsonl'));
  writeFileSync(path.join(outDir, 'summary.md'), summarize(rows, errors));
  writeFileSync(path.join(outDir, 'disagreements.md'), disagreements(rows));
  console.log(`\nWrote summary.md and disagreements.md to ${outDir}`);
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
    if (i === -1) return undefined;
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  };
  const files = fixtureFiles();

  // --model <id> restricts a pilot, a full run or the plan to one model.
  const modelArg = valueOf('--model');
  if (modelArg && !(EXTRACTION_MODELS as readonly string[]).includes(modelArg)) {
    throw new Error(`--model must be one of: ${EXTRACTION_MODELS.join(', ')}`);
  }
  const models: readonly ExtractionModel[] = modelArg ? [modelArg as ExtractionModel] : EXTRACTION_MODELS;

  if (args.includes('--regrade')) {
    const dir = valueOf('--regrade');
    if (!dir) throw new Error('--regrade needs a run directory');
    const expected = loadExpected();
    const rows = readJsonl<ResultRow>(path.join(dir, 'results.jsonl')).map((row) => ({
      ...row,
      grade: grade(row.extraction, expected[row.file]),
    }));
    writeFileSync(path.join(dir, 'results-regraded.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const errors = readJsonl<ErrorRow>(path.join(dir, 'errors.jsonl'));
    writeFileSync(path.join(dir, 'summary-regraded.md'), summarize(rows, errors));
    writeFileSync(path.join(dir, 'disagreements-regraded.md'), disagreements(rows));
    console.log(`Regraded ${rows.length} results in ${dir}`);
    return;
  }

  if (args.includes('--pilot')) {
    requireKey();
    const outDir = valueOf('--out') ?? path.join(repoRoot, 'eval-runs', `pilot-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    const existing = readJsonl<ResultRow>(path.join(outDir, 'results.jsonl'));
    const pending = pendingPairs([files[0]], models, existing);
    let hadError = false;
    if (pending.length === 0) console.log(`Pilot already complete in ${outDir}.`);
    else hadError = await runPairs(pending, outDir);
    const rows = readJsonl<ResultRow>(path.join(outDir, 'results.jsonl')).filter((row) => row.file === files[0]);
    const pilotBytes = readFileSync(path.join(fixturesDir, files[0])).length;
    const restBytes = files.slice(1).reduce((n, f) => n + readFileSync(path.join(fixturesDir, f)).length, 0);
    console.log('\nProjection for the remaining affidavits, scaled by file size from the pilot:');
    let total = 0;
    for (const row of rows) {
      const projected = row.costUsd * (restBytes / pilotBytes);
      total += projected;
      console.log(`  ${row.model}: pilot $${row.costUsd.toFixed(3)} (${row.usage.inputTokens} in / ${row.usage.outputTokens} out, ${(row.usage.elapsedMs / 1000).toFixed(0)}s); remaining about $${projected.toFixed(2)}`);
    }
    for (const model of models) {
      if (!rows.some((row) => row.model === model)) {
        console.log(`  ${model}: no pilot result (see errors.jsonl); not included in the total`);
      }
    }
    console.log(`  Total remaining: about $${total.toFixed(2)}`);
    console.log(`\nPilot results are in ${outDir}. To continue into the same directory:\n  npm run eval:extraction -- --full --out ${outDir}`);
    if (hadError) {
      console.error('Some calls threw unexpectedly; rerun the same command to retry them.');
      process.exitCode = 1;
    }
    return;
  }

  if (args.includes('--full')) {
    requireKey();
    const outDir = valueOf('--out');
    if (!outDir) throw new Error('--full needs --out <dir>');
    const done = readJsonl<ResultRow>(path.join(outDir, 'results.jsonl'));
    const pending = pendingPairs(files, models, done);
    console.log(`${done.length} results already saved; running ${pending.length} calls.`);
    const hadError = await runPairs(pending, outDir);
    writeReports(outDir);
    if (hadError) {
      console.error('Some calls threw unexpectedly; rerun the same command to retry them.');
      process.exitCode = 1;
    }
    return;
  }

  const pairs = pendingPairs(files, models, []);
  console.log(`Plan: ${files.length} affidavits x ${models.length} models = ${pairs.length} calls. No API call made.`);
  for (const { file, model } of pairs) console.log(`  ${model}  ${file}`);
  console.log('\nRun with --pilot to make the first three calls.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
