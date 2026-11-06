/**
 * Classifies a change set so CI can skip work that cannot matter.
 *
 *   runtime  the change can alter what production runs (the image, the box's
 *            deploy files, the database schema). Only this triggers a deploy.
 *   gate     the change can break the build or the tests: runtime, plus tests,
 *            test configs and CI itself. Only this runs the gate.
 *
 * Anything else (docs/, AGENTS.md, CLAUDE.md, README, .claude/, todos, images,
 * deploy/runbook.md ...) is documentation: no gate, no deploy. Editorial
 * pages under content/ are Markdown but ARE runtime (the image serves them).
 *
 * Fails safe: with no usable base commit, or if git cannot diff, both are true.
 * Plain .mjs so the check runs before `npm ci`.
 *
 * Usage: node scripts/ci/changed-paths.mjs [base] [head]   (head defaults to HEAD)
 */
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const RUNTIME_DIRS = /^(src|data|content|drizzle|jobs|deploy|scripts|public)\//;
const RUNTIME_FILES = /^(package\.json|package-lock\.json|Dockerfile|\.dockerignore|astro\.config\.mjs|tsconfig\.json|drizzle\.config\.ts)$/;
const GATE_ONLY = /^(tests\/|scripts\/ci\/|\.github\/(actions|workflows)\/|vitest\.config\.ts$|playwright\.config\.ts$)/;

/** @param {string} p */
export function isRuntime(p) {
  if (p.endsWith('.md') && !p.startsWith('content/')) return false;
  // CI-only scripts live under scripts/ (shipped in the image) but change nothing at run time.
  if (p.startsWith('scripts/ci/')) return false;
  return RUNTIME_DIRS.test(p) || RUNTIME_FILES.test(p);
}

/** @param {string[]} paths */
export function classify(paths) {
  const runtime = paths.some(isRuntime);
  const gate = runtime || paths.some((p) => GATE_ONLY.test(p));
  return { runtime, gate };
}

function main() {
  const [base, head = 'HEAD'] = process.argv.slice(2);
  let result = { runtime: true, gate: true };
  if (base && !/^0+$/.test(base)) {
    try {
      const out = execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' });
      result = classify(out.split('\n').filter(Boolean));
    } catch {
      // unknown base: keep the safe default
    }
  }
  const lines = `runtime=${result.runtime}\ngate=${result.gate}\n`;
  process.stdout.write(lines);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
