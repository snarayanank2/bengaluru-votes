import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseManifest } from '../../../scripts/ci/env-render';
import { formatPlan, planBootstrap } from '../../../scripts/ci/bootstrap-env';

const script = resolve(__dirname, '../../../deploy/install-env.sh');
const SENTINEL = 'sentinel-value-77a';
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'install-env-'));
  writeFileSync(join(dir, 'ssh'), `#!/usr/bin/env bash\nprintf '%s' "$*" > "$CAPTURE_ARGS"\ncat > "$CAPTURE_STDIN"\n`);
  chmodSync(join(dir, 'ssh'), 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(stdin: string) {
  const args = join(dir, 'args');
  const captured = join(dir, 'stdin');
  rmSync(args, { force: true });
  const r = spawnSync('bash', [script], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CAPTURE_ARGS: args, CAPTURE_STDIN: captured },
  });
  return { r, args: existsSync(args) ? readFileSync(args, 'utf8') : null, stdin: existsSync(captured) ? readFileSync(captured, 'utf8') : null };
}

describe('install-env.sh', () => {
  it('refuses empty stdin and never calls ssh', () => {
    const { r, args } = run('');
    expect(r.status).not.toBe(0);
    expect(args).toBeNull();
  });
  it('sends the content on stdin and keeps every value off the command line', () => {
    const { r, args, stdin } = run(`SESSION_SECRET=${SENTINEL}\n`);
    expect(r.status).toBe(0);
    expect(stdin).toBe(`SESSION_SECRET=${SENTINEL}\n`);
    expect(args).not.toContain(SENTINEL);
    expect(args).toContain('/etc/bengaluru-votes/.env.production');
    expect(args).toContain('chmod 600');
    expect(args).toContain('.env.production.prev');
  });
});

describe('bootstrap plan', () => {
  const entries = parseManifest('NODE_ENV var required\nSESSION_SECRET secret required\nSENTRY_DSN secret optional');
  const box = `NODE_ENV=production\nSESSION_SECRET=${SENTINEL}\nUNLISTED=1\nSENTRY_DSN=\n`;
  it('maps box keys to secrets and variables by the manifest and skips unlisted keys', () => {
    const p = planBootstrap(entries, box);
    expect(p.actions.map((a) => `${a.kind}:${a.name}`)).toEqual(['var:NODE_ENV', 'secret:SESSION_SECRET']);
    expect(p.skipped).toEqual(['UNLISTED']);
  });
  it('formats a dry run with names only', () => {
    const text = formatPlan(planBootstrap(entries, box));
    expect(text).toContain('would set secret SESSION_SECRET');
    expect(text).toContain('UNLISTED');
    expect(text).not.toContain(SENTINEL);
  });
});
