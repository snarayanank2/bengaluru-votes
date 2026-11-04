/**
 * One-time load of the box's current production values into the GitHub
 * `production` environment, so GitHub becomes the source of truth without
 * regenerating SESSION_SECRET or the Postgres password (changing either logs
 * everyone out or locks the app out of its database).
 *
 *   tsx scripts/ci/bootstrap-env.ts                 # dry run: key names only
 *   tsx scripts/ci/bootstrap-env.ts --apply         # gh secret/variable set --env production
 *
 * Values are read over SSH and handed to `gh` on stdin. They are never
 * printed. Keys on the box that the manifest does not list are skipped and
 * reported by name: add them to deploy/env.production.manifest, or decide to
 * drop them, before enabling auto-deploy.
 *
 * Env: VPS_SSH_ALIAS (default vps), GITHUB_REPOSITORY (default: the repo `gh` resolves).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEnvFile, parseManifest, type Entry } from './env-render';

export interface Plan { actions: { name: string; kind: Entry['kind']; value: string }[]; skipped: string[] }

export function planBootstrap(entries: Entry[], boxFile: string): Plan {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const actions: Plan['actions'] = [];
  const skipped: string[] = [];
  for (const [name, value] of parseEnvFile(boxFile)) {
    const e = byName.get(name);
    if (e) actions.push({ name, kind: e.kind, value });
    else skipped.push(name);
  }
  return { actions, skipped };
}

/** Names only: the dry run must be safe to paste anywhere. */
export function formatPlan(plan: Plan): string {
  const lines = plan.actions.map((a) => `would set ${a.kind} ${a.name}`);
  if (plan.skipped.length) lines.push('', `on the box but NOT in the manifest (skipped): ${plan.skipped.join(', ')}`);
  return lines.join('\n');
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const alias = process.env.VPS_SSH_ALIAS ?? 'vps';
  const entries = parseManifest(readFileSync(new URL('../../deploy/env.production.manifest', import.meta.url), 'utf8'));
  const box = execFileSync('ssh', [alias, 'cat /etc/bengaluru-votes/.env.production'], { encoding: 'utf8' });
  const plan = planBootstrap(entries, box);
  console.log(formatPlan(plan));
  if (!apply) {
    console.log('\n(dry run; pass --apply to write to the GitHub production environment)');
    return;
  }
  const repoArgs = process.env.GITHUB_REPOSITORY ? ['--repo', process.env.GITHUB_REPOSITORY] : [];
  for (const a of plan.actions) {
    const sub = a.kind === 'secret' ? 'secret' : 'variable';
    execFileSync('gh', [sub, 'set', a.name, '--env', 'production', ...repoArgs], { input: a.value, stdio: ['pipe', 'ignore', 'inherit'] });
    console.log(`set ${a.kind} ${a.name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
