/**
 * CI gate around `npm run translate -- --check`.
 *
 * The check exits 1 for any stale Kannada target. One is accepted until a real
 * ANTHROPIC_API_KEY lets it be regenerated (runbook, "Deploying"): the
 * location-privacy paragraph in content/pages/kn/privacy.md. Every other stale
 * target still fails the gate.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ACCEPTED = new Set(['content file: content/pages/kn/privacy.md']);
const ENTRY = /^\s*-\s+((?:i18n key|content file):\s*\S.*?)\s*$/;

export function evaluateTranslateCheck(output: string, exitCode: number): { ok: boolean; unexpected: string[] } {
  if (exitCode === 0) return { ok: true, unexpected: [] };
  const entries = output
    .split('\n')
    .map((l) => ENTRY.exec(l)?.[1])
    .filter((e): e is string => Boolean(e));
  if (entries.length === 0) {
    const first = output.split('\n').find((l) => l.trim()) ?? `exit code ${exitCode}`;
    return { ok: false, unexpected: [first.trim()] };
  }
  const unexpected = entries.filter((e) => !ACCEPTED.has(e));
  return { ok: unexpected.length === 0, unexpected };
}

function main(): void {
  const r = spawnSync('npm', ['run', '--silent', 'translate', '--', '--check'], { encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const result = evaluateTranslateCheck(output, r.status ?? 1);
  if (result.ok) {
    console.log('translate gate: ok');
    return;
  }
  console.error('translate gate: unexpected stale targets:');
  for (const u of result.unexpected) console.error(`  - ${u}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
