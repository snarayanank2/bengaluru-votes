/**
 * Chooses the release tag for a deploy: vYYYY.MM.DD, then .2, .3 ... for
 * further same-day releases (architecture §14.4). A tag already pointing at
 * this commit is reused, so re-running a workflow never mints a second tag.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface ExistingTag { name: string; commit: string }

export function chooseTag(opts: { date: string; existing: ExistingTag[]; commit: string }): { name: string; create: boolean } {
  const prefix = `v${opts.date}`;
  const suffixOf = (name: string): number | null => {
    if (name === prefix) return 1;
    const m = new RegExp(`^${prefix.replace(/\./g, '\\.')}\\.(\\d+)$`).exec(name);
    return m ? Number(m[1]) : null;
  };
  const today = opts.existing.filter((t) => suffixOf(t.name) !== null);
  const same = today.find((t) => t.commit === opts.commit);
  if (same) return { name: same.name, create: false };
  const next = Math.max(0, ...today.map((t) => suffixOf(t.name)!)) + 1;
  return { name: next === 1 ? prefix : `${prefix}.${next}`, create: true };
}

/** Parses `git ls-remote --tags` output, preferring the peeled (^{}) commit of annotated tags. */
export function parseLsRemote(out: string): ExistingTag[] {
  const byName = new Map<string, string>();
  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]{40})\s+refs\/tags\/(\S+?)(\^\{\})?$/.exec(line.trim());
    if (!m) continue;
    if (m[3] || !byName.has(m[2])) byName.set(m[2], m[1]);
  }
  return [...byName].map(([name, commit]) => ({ name, commit }));
}

function istDate(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p.replace(/-/g, '.');
}

function main(): void {
  const commit = process.argv[2] ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const out = execFileSync('git', ['ls-remote', '--tags', 'origin', 'v*'], { encoding: 'utf8' });
  const r = chooseTag({ date: process.argv[3] ?? istDate(), existing: parseLsRemote(out), commit });
  const lines = `tag=${r.name}\ncreate=${r.create}\n`;
  process.stdout.write(lines);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
