import { describe, expect, it } from 'vitest';
import { isTested, type ArtifactRow } from '../../../scripts/ci/tested-tree';

const REPO = 42;
const good: ArtifactRow = {
  name: 'tested-tree-abc123',
  expired: false,
  workflow_run: { id: 1, head_repository_id: REPO, head_branch: 'agent/x' },
  run: { path: '.github/workflows/ci.yml', event: 'pull_request', conclusion: 'success', base_branch: 'main' },
};
type Patch = { expired?: boolean; run?: Partial<ArtifactRow['run']>; workflow_run?: Partial<ArtifactRow['workflow_run']> };
const with_ = (p: Patch): ArtifactRow => ({
  ...good,
  expired: p.expired ?? good.expired,
  run: { ...good.run, ...p.run },
  workflow_run: { ...good.workflow_run, ...p.workflow_run },
});

describe('isTested', () => {
  it('accepts a matching artifact from ci.yml on a same-repo PR into main', () => {
    expect(isTested('abc123', [good], REPO)).toBe(true);
  });
  it('rejects expired', () => expect(isTested('abc123', [with_({ expired: true })], REPO)).toBe(false));
  it('rejects a fork (different head repository)', () => expect(isTested('abc123', [with_({ workflow_run: { head_repository_id: 7 } })], REPO)).toBe(false));
  it('rejects a push-event run', () => expect(isTested('abc123', [with_({ run: { event: 'push' } })], REPO)).toBe(false));
  it('rejects another workflow', () => expect(isTested('abc123', [with_({ run: { path: '.github/workflows/evil.yml' } })], REPO)).toBe(false));
  it('rejects a failed run', () => expect(isTested('abc123', [with_({ run: { conclusion: 'failure' } })], REPO)).toBe(false));
  it('rejects a PR into another branch', () => expect(isTested('abc123', [with_({ run: { base_branch: 'dev' } })], REPO)).toBe(false));
  it('accepts a merged PR whose run no longer lists its base (GitHub drops it after merge)', () => {
    const row = with_({});
    delete row.run.base_branch;
    expect(isTested('abc123', [row], REPO)).toBe(true);
  });
  it('rejects a different tree', () => expect(isTested('zzz', [good], REPO)).toBe(false));
  it('accepts when one of several artifacts qualifies', () => {
    expect(isTested('abc123', [with_({ expired: true }), good], REPO)).toBe(true);
  });
});
