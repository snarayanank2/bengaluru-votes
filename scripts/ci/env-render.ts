/**
 * Renders /etc/bengaluru-votes/.env.production from the GitHub `production`
 * environment, driven by deploy/env.production.manifest.
 *
 * Nothing here ever prints a value: errors and diffs name keys only.
 *
 *   tsx scripts/ci/env-render.ts render                  # stdout = the file
 *   tsx scripts/ci/env-render.ts compare --box <file>    # key-name diff vs the box's current file
 *
 * Values come from ALL_VARS / ALL_SECRETS (the JSON of the `vars` and
 * `secrets` contexts, so the manifest, not the workflow, lists the keys) or,
 * failing that, the plain environment.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface Entry { name: string; kind: 'secret' | 'var'; required: boolean }
export interface BoxDiff { missingInManifest: string[]; missingOnBox: string[]; changed: string[]; wouldBeRemoved: string[] }

/** Must never be set in production (runbook; src/lib/otp.ts, src/lib/send). */
export const FORBIDDEN = ['OTP_TEST_SINK', 'SENDS_DISABLED'];

export class EnvRenderError extends Error {}

export function parseManifest(text: string): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const m = /^([A-Z][A-Z0-9_]*)\s+(secret|var)\s+(required|optional)$/.exec(line);
    if (!m) throw new Error(`manifest line ${i + 1}: expected "NAME secret|var required|optional"`);
    if (seen.has(m[1])) throw new Error(`manifest line ${i + 1}: duplicate key ${m[1]}`);
    seen.add(m[1]);
    out.push({ name: m[1], kind: m[2] as Entry['kind'], required: m[3] === 'required' });
  });
  return out;
}

export function renderEnv(entries: Entry[], values: Record<string, string | undefined>): string {
  const missing: string[] = [];
  const badValue: string[] = [];
  const forbidden = FORBIDDEN.filter((k) => (values[k] ?? '') !== '');
  const lines: string[] = [];
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const v = values[e.name];
    if (v === undefined || v === '') {
      if (e.required) missing.push(e.name);
      continue;
    }
    if (/[\r\n]/.test(v)) {
      badValue.push(e.name);
      continue;
    }
    lines.push(`${e.name}=${v}`);
  }
  const problems = [
    missing.length && `missing required: ${missing.join(', ')}`,
    badValue.length && `value contains a line break: ${badValue.join(', ')}`,
    forbidden.length && `must not be set in production: ${forbidden.join(', ')}`,
  ].filter(Boolean);
  if (problems.length) throw new EnvRenderError(problems.join('; '));
  return `${lines.join('\n')}\n`;
}

export function valuesFromEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env.ALL_VARS !== undefined || env.ALL_SECRETS !== undefined) {
    return { ...JSON.parse(env.ALL_VARS || '{}'), ...JSON.parse(env.ALL_SECRETS || '{}') };
  }
  return { ...env };
}

export function parseEnvFile(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const mm = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!mm) continue;
    let v = mm[2];
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    if (v !== '') m.set(mm[1], v);
  }
  return m;
}

export function diffAgainstBox(entries: Entry[], boxFile: string, rendered: string): BoxDiff {
  const names = new Set(entries.map((e) => e.name));
  const box = parseEnvFile(boxFile);
  const next = parseEnvFile(rendered);
  const keys = (xs: Iterable<string>) => [...xs].sort();
  return {
    missingInManifest: keys([...box.keys()].filter((k) => !names.has(k))),
    missingOnBox: keys([...next.keys()].filter((k) => !box.has(k))),
    changed: keys([...next.keys()].filter((k) => box.has(k) && box.get(k) !== next.get(k))),
    wouldBeRemoved: keys([...box.keys()].filter((k) => names.has(k) && !next.has(k))),
  };
}

function main(): void {
  const [mode, flag, boxPath] = process.argv.slice(2);
  const manifestPath = new URL('../../deploy/env.production.manifest', import.meta.url);
  const entries = parseManifest(readFileSync(manifestPath, 'utf8'));
  try {
    const rendered = renderEnv(entries, valuesFromEnv(process.env));
    if (mode === 'render') {
      process.stdout.write(rendered);
    } else if (mode === 'compare' && flag === '--box' && boxPath) {
      const d = diffAgainstBox(entries, readFileSync(boxPath, 'utf8'), rendered);
      console.log(JSON.stringify(d, null, 2));
      if (Object.values(d).some((x) => x.length)) process.exit(1);
    } else {
      console.error('usage: env-render.ts render | compare --box <file>');
      process.exit(2);
    }
  } catch (e) {
    if (e instanceof EnvRenderError) {
      console.error(`env render failed: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
