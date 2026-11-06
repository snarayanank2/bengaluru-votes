import { describe, expect, it } from 'vitest';
import { classify } from '../../../scripts/ci/changed-paths.mjs';

describe('classify', () => {
  it.each([
    [['docs/architecture.md']],
    [['AGENTS.md', 'CLAUDE.md', 'README.md']],
    [['.claude/agents/ui-verifier.md']],
    [['deploy/runbook.md']],
    [['src/features/pages/README.md']],
    [['todos.md', 'images/oorvani.png']],
  ])('docs only: no gate, no deploy %j', (paths) => {
    expect(classify(paths)).toEqual({ runtime: false, gate: false });
  });

  it.each([
    [['src/pages/index.astro']],
    [['content/pages/en/about.md']],
    [['content/pages/kn/about.md']],
    [['drizzle/0019_x.sql']],
    [['deploy/compose.production.yml']],
    [['deploy/nginx/site.conf']],
    [['package-lock.json']],
    [['Dockerfile']],
    [['scripts/seed-wards.ts']],
    [['docs/a.md', 'src/lib/x.ts']],
  ])('runtime change: gate and deploy %j', (paths) => {
    expect(classify(paths)).toEqual({ runtime: true, gate: true });
  });

  it.each([
    [['tests/routes/ward.test.ts']],
    [['vitest.config.ts']],
    [['playwright.config.ts']],
    [['.github/workflows/ci.yml']],
    [['.github/actions/gate/action.yml']],
    [['scripts/ci/tag.ts']],
  ])('tests or CI only: gate, no deploy %j', (paths) => {
    expect(classify(paths)).toEqual({ runtime: false, gate: true });
  });

  it('an empty change set is docs-equivalent', () => {
    expect(classify([])).toEqual({ runtime: false, gate: false });
  });
});
