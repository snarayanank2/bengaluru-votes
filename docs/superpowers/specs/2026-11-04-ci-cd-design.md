# CI/CD: test every change, deploy every merge to main

Status: draft for approval, 2026-11-04.

## Intent

Siva wants to change this project using cloud coding agents with no dependency on his laptop. Today a human runs checks locally, tags a commit and runs `deploy/deploy.sh` from a laptop with SSH access to the production VPS. That is the laptop dependency.

The goal is that a change travels from an agent's pull request to production without a laptop: checks run in GitHub, a merge to `main` that is good deploys itself, and a failure tells Siva by email. Production secrets live in GitHub, not only on the box.

This deliberately reverses architecture.md §14.4 ("deploys are manual", CI removed 2026-08-13). That revision removed CI because an Actions workflow held a root SSH key and a malicious merge reached production with no gate. This design has to answer that concern; see "Security".

## Goals

1. A PR into `main` cannot merge until its checks pass.
2. A push to `main` runs the checks, unless the exact code about to ship has just passed them, and deploys to production if they pass. No approval click.
3. All production configuration and secrets live in the GitHub environment named `production`. Every deploy writes them to the box, so GitHub is the source of truth.
4. Agents' PRs and external contributors' PRs merge by the same rules. Auto-merge on a green PR for Siva and his agents; Siva clicks merge on external contributors' PRs.
5. A failed deploy emails Siva. A deploy that fails after the new version starts serving rolls back by itself.
6. Everything, including rollback and redeploy, can be done from GitHub with no laptop.

## Non-goals and anti-goals

- No staging environment, no registry, no new infrastructure. The box keeps building its own image (§14.3) and `deploy.sh` keeps doing the deploy and the verification, including the real `POST /api/ward-lookup` check.
- No manual approval gate and no pause for migrations. Siva decided both explicitly.
- Anti-goal: any path by which code from a pull request, especially one from a fork, runs with production secrets or SSH access before it has been merged to `main`.
- Anti-goal: a deploy that silently writes a wrong or incomplete env file. A missing required value must stop the deploy before the box is touched.
- Not in scope: writing the "good set of tests". Siva is treating the fast, trustworthy suite as separate work. The pipeline runs whatever the gate commands are.

## Context the builder needs

- Repo: `snarayanank2/bengaluru-votes`, **public**, on a personal account (not an organization). Siva has admin. Merge queue is unavailable on personal repos, which is why the skip rule below compares file contents instead.
- No `.github/` exists. Earlier CI is in git history (`git log -- .github`, removed in `05c6de3`); reuse ideas, not files.
- The box is reached over SSH as `root` (alias `vps`, override `VPS_SSH_ALIAS`). The production checkout is `/root/src/bengaluru-votes-production`. The env file is `/etc/bengaluru-votes/.env.production`, mode 600, referenced through `PROD_ENV_FILE`.
- `deploy/deploy.sh production <tag>` and `... --rollback` do the whole deploy and verify it. Production is a detached checkout of an annotated tag `vYYYY.MM.DD`, with `.2`, `.3` for further same-day releases.
- The gate commands today (runbook "Deploying"): `npm run typecheck`, `npm run translate -- --check`, `npm test`. `npm test` is Vitest and needs Postgres. A database named `bv_test` is the convention and AGENTS.md "Tests need a database" lists environment variables that must be unset or set; a clean CI runner needs only `SITE_ORIGIN=https://bengaluruvotes.opencity.in` and `DATABASE_URL`. There is also a Playwright suite (`build:e2e`, `seed:e2e`, `test:e2e`) against `bv_e2e`.
- `translate --check` has one accepted exception: `content/pages/kn/privacy.md` is a known stale target. The gate must tolerate exactly that file and fail on any other. (Remove the exception when it is regenerated; see runbook.)
- The env file has about 40 variables (runbook "Required environment variables"). Some are secrets (`SESSION_SECRET`, `POSTGRES_PASSWORD`, `DATABASE_URL`, vendor keys, `MASTER_PASSWORD`), some are plain config (`SITE_ORIGIN`, `GA_MEASUREMENT_ID`, budgets, `RETENTION_ENABLED`). `OTP_TEST_SINK` and `SENDS_DISABLED` must never be set in production.
- The app already sends mail through SendGrid (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`).

## Design

### Workflows

**`ci.yml` — runs on `pull_request`.** One job, `test`, with a hard 5-minute job timeout (Siva's target is a 2-minute suite; the timeout makes a hang fail loudly). It starts a Postgres service container, installs with `npm ci`, and runs the gate: typecheck, translate check (with the single accepted exception), `npm test`, and an `astro build` so a build break is caught before a tag exists. Whether the Playwright smoke suite belongs in the gate depends on the measured total; include it if the whole job stays under about 2 minutes, otherwise leave it out and say so. Trigger is plain `pull_request`, never `pull_request_target`; the job has `permissions: contents: read` and no secrets. On success it uploads a tiny artifact named `tested-tree-<T>` where `<T>` is `git rev-parse HEAD^{tree}` of what it checked out (the merge of the PR into the base), with a retention of 30 days.

**`deploy.yml` — runs on `push` to `main`, and on `workflow_dispatch` for redeploy-a-tag and rollback.** Three jobs, with `concurrency: production-deploy` and `cancel-in-progress: false` so deploys queue and never overlap.

1. `decide` (no secrets). Computes `T = git rev-parse HEAD^{tree}` for the pushed commit and asks the Actions artifacts API whether an artifact named `tested-tree-<T>` exists, is unexpired, and came from a run in this repository (not a fork). If so, `tested=true`.
2. `test` (no secrets), only if `tested` is false. The same gate as `ci.yml`, factored into a reusable workflow or composite action so the two cannot drift.
3. `deploy` (environment `production`), only if `decide` said tested or `test` passed. Steps: create the next date tag on this commit and push it; render and install the env file; run `deploy/deploy.sh production <tag>` from the runner; on failure after restart, run `--rollback`; on any failure, send the alert email.

Why file contents and not commit hashes: a squash merge always produces a new commit, so the PR's commit never equals main's. The tree is identical when nothing else landed in between, and different when something did, in which case the tests rerun on the real merged result. A direct commit to `main` has no matching artifact, so it is tested. A PR from a fork never counts as tested for skipping, because a fork's run executes the fork's own copy of the workflow; its tests rerun after merge. That costs about two minutes and removes the forgery path.

### Branch protection and merge rules

Configure as a repository ruleset (applied through `gh api`, not by hand, and recorded in the repo so it is reviewable):

- `main`: require a pull request, require the `test` check, block force pushes and deletion. Siva (admin) is allowed to bypass, which is what permits his direct commits; those then run the full gate before deploying.
- Auto-merge enabled on the repository. Siva's agents enable it on their own PRs; external contributors' PRs wait for Siva to merge.
- Actions setting "Require approval for first-time contributors" (or all outside collaborators) on, so a fork's first run waits for Siva.
- No review requirement of any kind, including for `.github/` and `deploy/` (Siva's decision, 2026-11-04, chosen over giving agents a separate GitHub identity). A PR that changes the workflows or deploy script is therefore gated only by the tests.
- The `production` environment allows deployment from `main` only.

### Secrets and configuration

Everything that ends up in `.env.production` lives in the `production` GitHub environment: secret values as environment secrets, plain config as environment variables.

- A committed manifest (`deploy/env.production.manifest`, one line per key: name, `secret` or `var`, `required` or `optional`) is the contract. It replaces the runbook table as the machine-readable list; the runbook table stays and points to it.
- A render script reads the manifest and the environment's values and produces the file. It fails the deploy, before any SSH, if a required key is empty, if a forbidden key (`OTP_TEST_SINK`, `SENDS_DISABLED`) is present, or if a value contains a character that breaks env files (newline; the runbook already warns about `#`, `$`, quotes).
- Installation: write to a temporary file on the box, set mode 600 and root ownership, keep the previous file as `.env.production.prev`, then rename into place atomically. The value goes over SSH stdin, never on a command line. Secrets are masked in logs by GitHub; the script must also never echo them.
- Because the file is rewritten on every deploy from GitHub, a hand edit on the box is overwritten. Say so in the runbook. Rotating a secret becomes: change it in GitHub, rerun the deploy.
- Some changes need a container recreate, not a rebuild; `deploy.sh`'s `up -d` handles that because the compose project reads the file at start.
- Env-only changes (a budget, a kill switch) should be deployable without a code change: `workflow_dispatch` with "redeploy current production tag" reinstalls the env and restarts.

### One-time bootstrap (the risky part)

`SESSION_SECRET` and the Postgres password exist only on the box today. Changing either would log everyone out or lock the app out of its own database, so they must be copied, not regenerated.

1. A script run once, by Siva from a machine that can SSH to the box, reads `/etc/bengaluru-votes/.env.production` and loads each key into the `production` environment via `gh secret set` / `gh variable set` according to the manifest. It prints key names only, never values.
2. A dry-run mode of the render script compares what it would write against the file on the box, key by key, and reports differences by key name. Auto-deploy is not enabled (the `deploy` job is not wired to `push`) until that comparison shows no unexpected differences. Expected differences are limited to formatting.
3. Only then does the workflow get its `push` trigger.

### SSH access from CI

A new dedicated key pair for CI (not Siva's personal key), private half stored as an environment secret, public half added to the box's `authorized_keys`, host key pinned in the workflow rather than trusted on first use. The key can be revoked without touching Siva's own access. It has the same root access as Siva's key. Restricting it to a forced command is not done here, because `deploy.sh` issues many different remote commands; it is a possible later hardening. The box's SSH is open to the internet on port 22 (key-only, `ufw`), so GitHub-hosted runners can reach it with no firewall change.

### Failure handling and email

- Failure before `up -d` (build, migrate): the old version is still serving; CI fails and emails; nothing to roll back.
- Failure after `up -d` (nginx test, any `verify` check): CI runs `deploy.sh production --rollback`, which re-verifies, then emails that the deploy failed and rolled back. A rollback that itself fails emails with a clear "production may be down" subject.
- Email goes out through the SendGrid API from the deploy job, using the already-present `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` from the environment, to an address held in a `DEPLOY_ALERT_EMAIL` environment variable (Siva's address; not hardcoded in the repo). The message contains the commit, the tag, the failed step and a link to the run. A failure of the email itself must not hide the original failure: the job still ends red, and GitHub's built-in notification is the backstop.
- A failed `test` job on `main` (including direct commits) also emails, since nothing deploys and Siva should know `main` is red.

### Tagging

CI creates the annotated tag, replacing the human step. Format stays `vYYYY.MM.DD`, then `.2`, `.3`. The tag message records the commit and the workflow run. A re-run for the same commit must not create a second tag. The tag is pushed with the workflow's token; the box's `git fetch --tags` picks it up as today.

### Manual operations from GitHub

`workflow_dispatch` offers: redeploy the current production tag (picks up env changes), deploy a specific existing tag, roll back. All go through the same `production` environment and the same concurrency group. This is what replaces running `deploy.sh` from a laptop.

### Documentation to change in the same work

`docs/architecture.md` §14.4 and the §13 notes on deploy exposure; `deploy/runbook.md` "Deploying" (manual deploys become the fallback, env file is now generated); `.claude/skills/deploy-vps/SKILL.md`; AGENTS.md if it mentions the manual flow. Record the date and the reason for reversing the 2026-08-13 decision.

## Security

The previous design was withdrawn because CI held a root key and a bad merge could reach production. What changes this time, and what stays true:

- Production is reachable only from a workflow run triggered by a push to `main`, in the `production` environment restricted to `main`. PR runs, including forks, never see secrets.
- A push to `main` requires a PR that passed the required check, or Siva's own bypass. Nobody reviews changes to `.github/` or `deploy/`, so an agent PR (or a merged external PR) that rewrites the workflow can change what runs with production secrets. This is the largest accepted exposure of this design; the `production` environment's main-only rule and the fork-never-gets-secrets rule limit it to code that has been merged.
- What remains: a reviewed-but-malicious or buggy change that passes the tests still ships automatically. Siva accepted this with no approval gate. The deploy still runs as `root` on the box, so a leaked CI key or a compromised `main` is full compromise of production, as architecture.md §13 already records for any deploy key. Update that note rather than leaving it contradicting the new flow.
- Third-party actions are pinned by full commit SHA, `permissions` are set to the minimum per job, and no workflow interpolates PR-controlled text (title, branch name, body) into a shell command; the old CI needed a fix for exactly this (`54174ee`).

## Settled while reviewing the design

- **Tag push:** the `deploy` job has `contents: write` and pushes the tag with `GITHUB_TOKEN`. No tag ruleset is added. Tags pushed this way trigger no other workflow, which is what we want.
- **Check name:** the ruleset requires a check named exactly `test`. If the gate is a reusable workflow, the builder must confirm the reported name (it can appear as `ci / test`) and set the ruleset to what GitHub actually reports, after a first PR has run.
- **Skip-rule scope:** the tested-tree artifact counts only if its run is `ci.yml`, event `pull_request`, conclusion `success`, targeting `main`, from this repository's own branch (head repository equals the base repository).
- **Bootstrap order:** (1) merge the workflows with `deploy.yml` triggered only by `workflow_dispatch`; (2) Siva loads the environment with the bootstrap script; (3) a dispatch run proves SSH, host-key pinning, env install and rollback; (4) a separate small PR adds the `push` trigger. The host key is obtained by Siva running `ssh-keyscan` and checking it against the box.
- **`deploy.sh` is non-interactive** (no prompts, no dependence on a local checkout; everything runs over SSH to the alias). The builder may modify it. It currently exits 1 for every failure, so it should be changed to exit with a distinct code (say 3) for failures after `up -d`, so the workflow knows to roll back without guessing.
- **Manifest source:** start from the runbook table. The dry-run compare against the box's file is authoritative: any key present on the box and absent from the manifest must be added to the manifest or explicitly removed by Siva before auto-deploy is enabled; it is never dropped silently.
- **Postgres:** `postgres:16`, as in both compose files; the migrations use no extensions.
- **Translate exception:** `translate --check` prints one `content file:` or `i18n key:` line per stale target and exits 1. The gate parses those lines and passes only if the sole entry is `content/pages/kn/privacy.md`. No change to the tool.

## Production env keys found on the box (2026-11-04, names only)

Present: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `FLAGS_ABUSE_SECRET`, `GA_MEASUREMENT_ID`, `GEOCODE_DAILY_BUDGET`, `GOOGLE_GEOCODING_API_KEY`, `GOOGLE_MAPS_BROWSER_KEY`, `GOOGLE_MAPS_MAP_ID`, `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX` (empty), `MAPS_ENABLED`, `MASTER_PASSWORD`, `NEWS_QUERY_DAILY_BUDGET`, `NODE_ENV`, `OTP_DAILY_SEND_BUDGET`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `POSTGRES_USER`, `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_SITE_KEY`, `RETENTION_ENABLED`, `SESSION_SECRET`, `SITE_ORIGIN`.

On the box but missing from the runbook table: `FLAGS_ABUSE_SECRET`, `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX`, `NEWS_QUERY_DAILY_BUDGET`. The manifest must include them. Documented but not set on the box: all SendGrid and Twilio keys, `SENTRY_DSN`, the restic/AWS/Healthchecks keys, `EXTRACTION_*`, `ELECTORAL_API_*`, `EPIC_DAILY_BUDGET`, `ANONYMOUS_VOTE_DAILY_BUDGET`, `FLAGS_SUBMISSIONS_PAUSED`. The failure email relies on SendGrid, so `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` must be added to the environment (the app currently has no working email; `MASTER_PASSWORD` is on for that reason). Secrets by nature: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `FLAGS_ABUSE_SECRET`, `GOOGLE_GEOCODING_API_KEY`, `GOOGLE_SEARCH_API_KEY`, `MASTER_PASSWORD`, `POSTGRES_PASSWORD`, `RECAPTCHA_SECRET_KEY`, `SESSION_SECRET`.

## Decisions left to the builder

- Exact job layout and whether the gate is a reusable workflow or composite action.
- Whether Playwright is in the gate, decided by measured time.
- Manifest file format and the render script's language (Node/TypeScript is already in the repo).
- How `deploy.sh` reaches the box from the runner (alias via a generated `~/.ssh/config` is the least invasive change).
- After an automatic rollback, whether to also check the production tree back out to the previous tag so `git log -1` on the box stays an honest answer. The current rollback only retags the image.
- Artifact retention for tested-tree markers; 30 days is a starting point.
- Test database name inside CI.

## Calls made while writing this (for Siva to check)

- Skip-tests rule compares tree hashes through artifacts, and fork PRs never count as tested.
- Full dispatch menu (redeploy, specific tag, rollback) beyond what was asked, because "no laptop" implies rollback must work from GitHub.
- Dedicated CI SSH key rather than reusing Siva's.
- No CODEOWNERS or review rule (Siva's decision); see Security for the consequence.
- SendGrid via the existing key for the email, rather than a new mail service or GitHub's own notifications.
- Alert on a red `main` as well as on a failed deploy.
