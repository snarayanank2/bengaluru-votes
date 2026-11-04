import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// deploy.sh is exercised end to end against a fake `ssh` and `curl` on PATH.
// Exit codes are the contract the CI workflow relies on: 1 = failed before the
// stack restarted (old version still serving, nothing to roll back), 3 = failed
// at or after `up -d` (roll back), 0 = verified.

const script = resolve(__dirname, '../../deploy/deploy.sh');
let bin: string;

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'deploy-fakes-'));
  // Fails when FAKE_SSH_FAIL_ALL is set, or when the remote command contains
  // FAKE_SSH_FAIL_MATCH; otherwise succeeds silently.
  writeFileSync(
    join(bin, 'ssh'),
    `#!/usr/bin/env bash
[ -n "\${FAKE_SSH_FAIL_ALL:-}" ] && exit 255
if [ -n "\${FAKE_SSH_FAIL_MATCH:-}" ] && [[ "$*" == *"$FAKE_SSH_FAIL_MATCH"* ]]; then exit 1; fi
exit 0
`,
  );
  writeFileSync(
    join(bin, 'curl'),
    `#!/usr/bin/env bash
if [[ "$*" == *"-w"* ]]; then
  if [[ "$*" == *"-X POST"* ]]; then echo "\${FAKE_WARD_CODE:-200}"; else echo 200; fi
else
  echo '<html><script src="/_astro/app.abc.js"></script></html>'
fi
`,
  );
  chmodSync(join(bin, 'ssh'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
});

afterAll(() => rmSync(bin, { recursive: true, force: true }));

function run(env: Record<string, string> = {}) {
  return spawnSync('bash', [script, 'production', 'v2026.11.04'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
    encoding: 'utf8',
  });
}

describe('deploy.sh exit codes', () => {
  it('exits 1 when preflight ssh fails', () => {
    expect(run({ FAKE_SSH_FAIL_ALL: '1' }).status).toBe(1);
  });

  it('exits 1 when the build fails (before the restart)', () => {
    expect(run({ FAKE_SSH_FAIL_MATCH: ' build' }).status).toBe(1);
  });

  it('exits 3 when static-init fails (after up -d)', () => {
    expect(run({ FAKE_SSH_FAIL_MATCH: 'static-init' }).status).toBe(3);
  });

  it('exits 3 when verify gets a 403 from ward-lookup', () => {
    const r = run({ FAKE_WARD_CODE: '403' });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('403');
  });

  it('exits 0 when everything succeeds', () => {
    expect(run().status).toBe(0);
  });
});
