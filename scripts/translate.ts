#!/usr/bin/env tsx
/**
 * Dev-time Kannada translation script (architecture.md §9 "Bilingual
 * content"; brief: .superpowers/sdd/task-9-brief.md).
 *
 * Sources of truth → generated targets:
 *   - src/i18n/en.json (flat `{ key: string }`, plus a `__hints` block) →
 *     src/i18n/kn.json (same keys, plus a `__hashes` block: sha256 of the
 *     EN value that produced each KN value).
 *   - content/pages/en/*.md (frontmatter: title, description, optional
 *     `hints: string[]`) → content/pages/kn/*.md (frontmatter: title,
 *     description, `sourceHash` = sha256 of the FULL EN file's raw text).
 *
 * `npm run translate` finds every missing or stale target and regenerates
 * it UNCONDITIONALLY — there is no skip mark, and hand-edits to a
 * previously generated KN file/key are overwritten the next time its EN
 * source changes. Corrections belong in the `hints` (per-file frontmatter
 * array, per-key `__hints` entry) or in src/i18n/glossary.json for
 * site-wide terms — both are folded into every regeneration prompt.
 *
 * `npm run translate -- --check` only compares stored-hash vs current-hash
 * — no network/API calls — and exits 1 listing every stale/missing target,
 * or 0 when everything is current. This is the CI staleness gate (Task 10);
 * CI never needs an Anthropic key because this mode never calls the API.
 *
 * Generation backend (regeneration mode only):
 *   - Primary: the `@anthropic-ai/sdk`, model `claude-sonnet-5`, used
 *     whenever `ANTHROPIC_API_KEY` is set in the environment.
 *   - Fallback (DEV-MACHINE CONVENIENCE ONLY — not how CI or production
 *     runs this script): when no API key is present, shells out to the
 *     local `claude` CLI (`claude -p "<prompt>" --max-turns 1`) and reads
 *     its stdout as the translation. This lets a contributor iterate on
 *     translations from a machine that's logged into Claude Code but has
 *     no standalone Anthropic API key configured. If neither an API key
 *     nor the `claude` CLI is available, the script exits 1 with a clear
 *     message rather than silently doing nothing.
 *   - Prompt construction (`buildPrompt`) is IDENTICAL for both backends —
 *     only the transport differs.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import matter from 'gray-matter';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPT_DIR, '..');

const EN_JSON_PATH = path.join(REPO_ROOT, 'src/i18n/en.json');
const KN_JSON_PATH = path.join(REPO_ROOT, 'src/i18n/kn.json');
const GLOSSARY_PATH = path.join(REPO_ROOT, 'src/i18n/glossary.json');
const EN_CONTENT_DIR = path.join(REPO_ROOT, 'content/pages/en');
const KN_CONTENT_DIR = path.join(REPO_ROOT, 'content/pages/kn');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlossaryEntry {
  kn: string;
  review?: boolean;
  note?: string;
}

export type Glossary = Record<string, GlossaryEntry>;

// `label` is the target being generated (e.g. "content/pages/kn/privacy.md").
// It carries only into error messages — a failure has to name which target it
// was for, since the run continues past it and reports the survivors at the end.
type Backend = (prompt: string, label: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests/unit/translate.test.ts — no API calls)
// ---------------------------------------------------------------------------

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

function isDunderKey(key: string): boolean {
  return key.startsWith('__');
}

/**
 * Keys in `en` that are missing from `kn.__hashes` or whose stored hash no
 * longer matches the current EN value — i.e. missing-or-stale. `__`-prefixed
 * keys (e.g. `__hints`, `__hashes` itself) are metadata, not translatable
 * strings, and are ignored on both sides.
 */
export function staleKeys(en: Record<string, unknown>, kn: Record<string, unknown>): string[] {
  const hashes = (kn.__hashes as Record<string, string> | undefined) ?? {};
  const stale: string[] = [];
  for (const key of Object.keys(en)) {
    if (isDunderKey(key)) continue;
    const value = en[key];
    if (typeof value !== 'string') continue;
    if (hashes[key] !== sha256(value)) stale.push(key);
  }
  return stale;
}

/**
 * EN content filenames (e.g. "about.md") whose KN counterpart is missing, or
 * whose stored `sourceHash` frontmatter no longer matches the sha256 of the
 * full current EN file content.
 */
export function staleContentFiles(enDir: string, knDir: string): string[] {
  const files = existsSync(enDir)
    ? readdirSync(enDir).filter((f) => f.endsWith('.md')).sort()
    : [];
  const stale: string[] = [];
  for (const file of files) {
    const enRaw = readFileSync(path.join(enDir, file), 'utf-8');
    const expectedHash = sha256(enRaw);
    const knPath = path.join(knDir, file);
    if (!existsSync(knPath)) {
      stale.push(file);
      continue;
    }
    const { data } = matter(readFileSync(knPath, 'utf-8'));
    if (data.sourceHash !== expectedHash) stale.push(file);
  }
  return stale;
}

/**
 * Builds the (identical, backend-agnostic) translation prompt: neutral
 * civic-platform framing, the full glossary (verbatim renderings, included
 * on every call so a term never renders two ways site-wide), the caller's
 * hints (per-key or per-file corrections, applied on every regeneration so
 * a fix survives future EN edits), and the source text/JSON to translate.
 */
export function buildPrompt(source: string, hints: string[], glossary: Glossary): string {
  const glossaryLines = Object.entries(glossary)
    .map(([term, entry]) => {
      const note = entry.note ? ` (${entry.note})` : '';
      return `- "${term}" → "${entry.kn}"${note}`;
    })
    .join('\n');

  const hintLines = hints.length > 0 ? hints.map((h) => `- ${h}`).join('\n') : '(none)';

  return `You are translating English into Kannada (ಕನ್ನಡ) for a neutral, non-partisan civic election information platform serving Bengaluru citizens ahead of the GBA (Greater Bengaluru Authority) ward corporator elections.

Glossary — these terms MUST render with the exact Kannada wording below, verbatim, every time they appear. Never substitute a different phrasing for one of these terms:
${glossaryLines || '(none)'}

Translation hints — specific corrections to apply wherever relevant:
${hintLines}

Rules:
- Preserve Markdown structure — headings, lists, emphasis, and links — EXACTLY as given.
- Preserve every HTML comment (<!-- ... -->) EXACTLY, verbatim, character for character. Do NOT translate any text inside an HTML comment; carry it through unchanged.
- Do not add, remove, or reorder keys, links, headings, or list items.
- If the source below is a JSON object, respond with ONLY a valid JSON object containing the exact same keys, each value translated into Kannada — no preamble, no markdown code fences, no explanation, nothing but the JSON object.
- If the source below is plain text, respond with ONLY the Kannada translation — no preamble, no surrounding quotes, no explanation.

Source (English):
${source}`;
}

// ---------------------------------------------------------------------------
// JSON I/O helpers
// ---------------------------------------------------------------------------

function readJson(filePath: string): Record<string, any> {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath: string, data: Record<string, unknown>): void {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

/** Strips a ```json ... ``` (or bare ```) fence if the model added one despite instructions. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1].trim() : trimmed;
}

function parseJsonResponse(text: string): Record<string, string> {
  const cleaned = stripCodeFence(text);
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// Backend resolution — controller-decided per the task brief
// ---------------------------------------------------------------------------

/**
 * Output budget for one generation.
 *
 * WHY THIS IS NOT 8192 ANY MORE. claude-sonnet-5 runs adaptive thinking
 * whenever the request omits `thinking`, and `max_tokens` bounds thinking AND
 * response text *together*. At 8192 the longest content file
 * (content/pages/kn/privacy.md) spent the whole budget thinking and returned a
 * response whose only block was a thinking block — which surfaced as the
 * misleading "contained no text block" error on 2026-08-14. Kannada also
 * tokenizes far less densely than English, so a KN target is several times its
 * EN source in tokens; the budget has to cover that plus the thinking.
 *
 * Streaming is required at this size: a non-streaming request much above
 * ~16k risks an SDK HTTP timeout well before the model is finished.
 */
const MAX_OUTPUT_TOKENS = 32_000;

type AnthropicResponse = {
  stop_reason?: string | null;
  content: Array<{ type: string; text?: string }>;
};

/**
 * Pull the translated text out of a response, or throw an error that names the
 * actual fault. Exported for tests — the two failure modes below look identical
 * from the outside (no usable text) but need opposite responses from whoever
 * is running the script, so they must not share a message.
 */
export function extractText(response: AnthropicResponse, label: string): string {
  const textBlock = response.content.find((block) => block.type === 'text');

  if (textBlock && typeof textBlock.text === 'string') {
    return textBlock.text.trim();
  }

  // Budget exhausted before any text was emitted. Retrying is pointless and
  // the model is not at fault — MAX_OUTPUT_TOKENS is what has to change.
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `translate: ${label} hit the ${MAX_OUTPUT_TOKENS}-token output limit (stop_reason=max_tokens) ` +
        'before producing any text. On a thinking model max_tokens covers thinking and output ' +
        'together — raise MAX_OUTPUT_TOKENS in scripts/translate.ts.',
    );
  }

  throw new Error(`translate: ${label} — Anthropic response contained no text block`);
}

async function callAnthropic(prompt: string, label: string): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });
  return extractText(await stream.finalMessage(), label);
}

async function callClaudeCli(prompt: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('claude', ['-p', prompt, '--max-turns', '1'], {
      maxBuffer: 1024 * 1024 * 32,
      timeout: 120_000,
    });
    return stdout.trim();
  } catch (err) {
    // Distinguish non-zero exit codes from other errors
    if (err instanceof Error && 'code' in err && typeof (err as any).code === 'number') {
      throw new Error(
        `translate: claude CLI exited with code ${(err as any).code}${(err as any).signal ? ` (signal ${(err as any).signal})` : ''}`,
      );
    }
    throw err;
  }
}

async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync('claude', ['--version'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function resolveBackend(): Promise<Backend> {
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('translate: ANTHROPIC_API_KEY detected — using @anthropic-ai/sdk (model claude-sonnet-5).');
    return callAnthropic;
  }

  if (await isClaudeCliAvailable()) {
    console.log(
      'translate: ANTHROPIC_API_KEY not set — falling back to the local `claude` CLI ' +
        '(dev-machine convenience only; see script header). Each call may take 10-60s.',
    );
    return callClaudeCli;
  }

  console.error(
    'translate: no generation backend available. Set ANTHROPIC_API_KEY to use the Anthropic ' +
      'API directly, or install and log in to the `claude` CLI to use the dev-machine fallback.',
  );
  process.exit(1);
}

/** Calls the backend for one target, retrying once on empty output or error. */
async function generateWithRetry(prompt: string, backend: Backend, label: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await backend(prompt, label);
      if (result.trim().length > 0) return result;
      console.error(`translate: empty output for ${label} (attempt ${attempt}/2)`);
    } catch (err) {
      console.error(
        `translate: error generating ${label} (attempt ${attempt}/2): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generation — i18n keys (batched into a single call)
// ---------------------------------------------------------------------------

async function translateKeysBatch(
  keys: string[],
  en: Record<string, any>,
  kn: Record<string, any>,
  glossary: Glossary,
  backend: Backend,
): Promise<boolean> {
  const source: Record<string, string> = {};
  for (const key of keys) source[key] = en[key];

  const enHints = (en.__hints as Record<string, string> | undefined) ?? {};
  const hints = keys
    .filter((key) => enHints[key])
    .map((key) => `${key}: ${enHints[key]}`);

  const prompt = buildPrompt(JSON.stringify(source, null, 2), hints, glossary);
  const label = `kn.json (${keys.length} key${keys.length === 1 ? '' : 's'})`;
  const raw = await generateWithRetry(prompt, backend, label);
  if (raw === null) return false;

  let translated: Record<string, string>;
  try {
    translated = parseJsonResponse(raw);
  } catch (err) {
    console.error(`translate: could not parse JSON response for ${label}: ${(err as Error).message}`);
    return false;
  }

  const missing = keys.filter((key) => typeof translated[key] !== 'string');
  if (missing.length > 0) {
    console.error(`translate: response for ${label} is missing keys: ${missing.join(', ')}`);
    return false;
  }

  kn.__hashes = kn.__hashes ?? {};
  for (const key of keys) {
    kn[key] = translated[key];
    kn.__hashes[key] = sha256(en[key]);
  }
  console.log(`translate: regenerated ${label}.`);
  return true;
}

// ---------------------------------------------------------------------------
// Generation — editorial content files (one call per file)
// ---------------------------------------------------------------------------

async function translateContentFile(file: string, glossary: Glossary, backend: Backend): Promise<boolean> {
  const enPath = path.join(EN_CONTENT_DIR, file);
  const enRaw = readFileSync(enPath, 'utf-8');
  const sourceHash = sha256(enRaw);
  const { data, content: body } = matter(enRaw);

  const hints: string[] = Array.isArray(data.hints) ? data.hints : [];
  const source = JSON.stringify(
    { title: data.title, description: data.description, body },
    null,
    2,
  );

  const prompt = buildPrompt(source, hints, glossary);
  const label = `content/pages/kn/${file}`;
  const raw = await generateWithRetry(prompt, backend, label);
  if (raw === null) return false;

  let translated: { title?: string; description?: string; body?: string };
  try {
    translated = parseJsonResponse(raw);
  } catch (err) {
    console.error(`translate: could not parse JSON response for ${label}: ${(err as Error).message}`);
    return false;
  }

  if (
    typeof translated.title !== 'string' ||
    typeof translated.description !== 'string' ||
    typeof translated.body !== 'string'
  ) {
    console.error(`translate: response for ${label} is missing title/description/body`);
    return false;
  }

  mkdirSync(KN_CONTENT_DIR, { recursive: true });
  const knFrontmatter = { title: translated.title, description: translated.description, sourceHash };
  const knRaw = matter.stringify(translated.body, knFrontmatter);
  writeFileSync(path.join(KN_CONTENT_DIR, file), knRaw, 'utf-8');
  console.log(`translate: regenerated ${label}.`);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const checkOnly = process.argv.slice(2).includes('--check');

  const en = readJson(EN_JSON_PATH);
  const kn = readJson(KN_JSON_PATH);

  const staleKeyList = staleKeys(en, kn);
  const staleFileList = staleContentFiles(EN_CONTENT_DIR, KN_CONTENT_DIR);

  if (checkOnly) {
    if (staleKeyList.length === 0 && staleFileList.length === 0) {
      console.log('translate --check: all Kannada i18n keys and content pages are up to date.');
      return;
    }
    console.error('translate --check: missing or stale Kannada targets found:');
    for (const key of staleKeyList) console.error(`  - i18n key: ${key}`);
    for (const file of staleFileList) console.error(`  - content file: content/pages/kn/${file}`);
    process.exit(1);
  }

  if (staleKeyList.length === 0 && staleFileList.length === 0) {
    console.log('translate: nothing to do — all Kannada i18n keys and content pages are up to date.');
    return;
  }

  console.log(
    `translate: ${staleKeyList.length} stale/missing i18n key(s), ${staleFileList.length} stale/missing content file(s).`,
  );

  const glossary = readJson(GLOSSARY_PATH) as Glossary;
  const backend = await resolveBackend();

  const failures: string[] = [];

  if (staleKeyList.length > 0) {
    const ok = await translateKeysBatch(staleKeyList, en, kn, glossary, backend);
    if (!ok) failures.push(`i18n keys: ${staleKeyList.join(', ')}`);
    writeJson(KN_JSON_PATH, kn); // write whatever succeeded, even on partial failure
  }

  for (const file of staleFileList) {
    const ok = await translateContentFile(file, glossary, backend);
    if (!ok) failures.push(`content file: content/pages/kn/${file}`);
  }

  if (failures.length > 0) {
    console.error('translate: completed with failures — the following targets were NOT regenerated:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('translate: done — all stale/missing Kannada targets regenerated.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
