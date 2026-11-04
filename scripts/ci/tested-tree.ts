/**
 * Decides whether the tree about to ship was already tested by a PR run.
 *
 * A squash merge always creates a new commit, so commits cannot be compared;
 * file contents (the git tree hash) can. ci.yml uploads an artifact named
 * `tested-tree-<tree>` when it passes. This accepts such an artifact only from
 * a run of ci.yml, on a `pull_request` into main, that succeeded, from a
 * branch of THIS repository. A fork's run executes the fork's own copy of the
 * workflow, so it could claim any tree; those runs never count.
 */
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export interface ArtifactRow {
  name: string;
  expired: boolean;
  workflow_run: { id: number; head_repository_id: number; head_branch: string };
  run: { path: string; event: string; conclusion: string | null; base_branch?: string };
}

export function isTested(tree: string, artifacts: ArtifactRow[], repoId: number): boolean {
  return artifacts.some(
    (a) =>
      a.name === `tested-tree-${tree}` &&
      !a.expired &&
      a.workflow_run.head_repository_id === repoId &&
      a.run.path.startsWith('.github/workflows/ci.yml') &&
      a.run.event === 'pull_request' &&
      a.run.conclusion === 'success' &&
      a.run.base_branch === 'main',
  );
}

function gh<T>(path: string): T {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' })) as T;
}

function main(): void {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  const repoId = gh<{ id: number }>(`repos/${repo}`).id;
  const list = gh<{ artifacts: { name: string; expired: boolean; workflow_run: ArtifactRow['workflow_run'] }[] }>(
    `repos/${repo}/actions/artifacts?name=tested-tree-${tree}&per_page=100`,
  );
  const rows: ArtifactRow[] = list.artifacts.map((a) => {
    const run = gh<{ path: string; event: string; conclusion: string | null; pull_requests?: { base: { ref: string } }[] }>(
      `repos/${repo}/actions/runs/${a.workflow_run.id}`,
    );
    return { ...a, run: { path: run.path, event: run.event, conclusion: run.conclusion, base_branch: run.pull_requests?.[0]?.base.ref } };
  });
  const line = `tested=${isTested(tree, rows, repoId)}\n`;
  process.stdout.write(`tree=${tree}\n${line}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
