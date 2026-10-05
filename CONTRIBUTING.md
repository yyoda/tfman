# Contributing to tfman

This document covers maintainer-only tooling and workflows: things that exist to develop and validate tfman itself, but are **not** part of what gets shipped to consumer repositories via the `deploy-tfman` skill.

For consumer-facing documentation (the workflows and CLI that actually ship), see [`.github/workflows/README.md`](.github/workflows/README.md).

---

## What actually ships to consumer repos

`deploy-tfman`'s `SKILL.md` (Step 6, `WORKFLOW_FILES`) is the single source of truth for which workflow files are distributed — check it before assuming a workflow you add under `.github/workflows/` will be rolled out automatically. `pr-review-dispatch.yml` is part of that list.

Everything under `.github/tfman/` ships except `.github/tfman/tests/`, which is excluded by design.

Keep `.github/workflows/README.md` limited to documenting what's in that list — anything else (a maintainer-only workflow, a dev script, a test fixture) belongs here instead, so it doesn't leak into every consumer repo's copy of that README.

## LintWorkflows

- **PURPOSE**:
    - Statically checks the workflow files themselves with [actionlint](https://github.com/rhysd/actionlint) whenever `.github/workflows/**` changes.
- **BEHAVIOR**:
    - Validates workflow syntax, expression types, `needs`/`outputs` wiring and action inputs, and runs `shellcheck` on every `run:` block.
    - Fails the PR on any finding. The actionlint version is pinned in the workflow (`ACTIONLINT_VERSION`).

This workflow is not in `WORKFLOW_FILES`, so it never ships to consumer repos.

## Testing the workflows

Workflow testing has three layers:

- Unit tests: `cd .github/tfman && node --test` (automatic discovery includes all nested test directories).
- Static checks: run `actionlint`; `LintWorkflows` also runs it in CI.
- End-to-end tests: run `bash scripts/e2e-prcomment.sh` locally from a checkout with no tracked changes, an `origin` remote, and authenticated `gh`. The script requires only Bash, `gh`, `jq`, `git`, `sed`, `date`, and `sleep`. It creates a temporary branch and draft PR on the current repository, exercises PRReview plans, ignored comments, PRComment plans, early cancellation, apply, a broken formatting fixture, plan provenance stamp checks, a post-plan job rerun, and a stale post-plan rerun that must preserve existing comments, a whole-PR dispatch rejection before any plan job starts, and a stale-head dispatch that must preserve the plan comment snapshot, then posts a results table and closes the PR. It restores the original local branch and deletes the local test branch. The fixtures under `environments/` exist for this testing; `test1` and `test2` use only null/random providers and need no cloud credentials. Authorized apply requires the developer's login in `APPLIERS` and changes the fixture state.

The e2e script uses the developer's local `gh` authentication because PRs and comments created by Actions with `GITHUB_TOKEN` do not trigger the corresponding `pull_request`/`issue_comment` workflows. Run it without concurrent PRComment activity: issue-comment runs use the default branch, so it selects the newest run after each command across the repository. Dispatch scenarios invoke `gh workflow run pr-review-dispatch.yml --repo "$repo" --ref "$base"` with `pr_number` and `head_sha` inputs and verify that `$base` equals the repository default branch before dispatching. Run selection requires a new run ID, the expected `PRReview #<pr_number> <head_sha>` title, `headBranch == $base`, and event `workflow_dispatch`. They require that workflow on the default branch and no `.github/copilot-autofix-config.json` there: every root must be rejected by the gate. They check the exact dispatch title, successful detection and posting, failed `authorize-roots`, skipped or absent plan jobs, failure rows for every root from the run job list (both fixture roots when present), with no artifact, and a `merge_commit=none` stamp. If rejection prevents matrix expansion, expected roots come from the preceding PRReview job list after verifying that its head SHA matches. Stale-head dispatch must fail specifically at `detect-changes` → `Resolve PR context` and preserve comments. Run the suite against `main` after the feature is merged, in one sitting: rerun scenarios need run artifacts, which are retained for 1 day. Early cancellation is timing-sensitive: if the cancel lands after `Terraform Plan` has already finished, an artifact is produced and the run cannot show an early cancellation, so the scenario retries up to three times and fails only if every attempt was too late.

PRReview handles only `pull_request` events and has no allowlist gate: its YAML
comes from the PR itself and cannot form an authorization boundary.
PRReviewDispatch handles only `workflow_dispatch`, always applying the allowlist
when changed roots exist. Its title is exactly `PRReview #<pr_number> <head_sha>`
and its concurrency group is `PRReview-pr-<pr_number>` with cancellation enabled.
Its checks attach to the default-branch commit; comments use `merge_commit=none`.
Anyone with write access can start a dispatch. Dispatches must be started from
the default branch. The first `Require default-branch ref` step enforces this as
an operator safeguard; branch editors can remove it from their workflow. The inline scope check rejects
forks, closed PRs, stale heads, bases other than the repository default branch, changed symlinks/submodules, and
changes inside generated `.terraform/` or `.terraform.d/` trees. The protected
paths (`.github`, `.tflint.hcl`, `trivy.yaml`, `.tfdeps.json`, `.tfdepsignore`,
`.gitmodules`, `.gitattributes`, and root `.terraform-version`) must equal the
base tip, so a branch behind protected base-side updates must be updated first.
Unchanged base symlinks inside roots are accepted and their targets must be trusted.
Provider and TFLint caches are neither restored nor saved on dispatch.
Dispatch artifacts are downloaded outside the checkout into
`${{ runner.temp }}/tfman-plans`; PRReview still downloads into its PR-controlled
checkout. Unexpected result paths are ignored and duplicates fail the affected
root whenever `expectedPaths` is non-empty.
The default-branch `authorize-roots` job has only `contents: read` permission;
the config is read at the SHA resolved from `heads/<default_branch>`. The plan
condition `needs.detect-changes.outputs.has-changes == 'true'` uses implicit
`success()`, requiring both detection and authorization to succeed. A failed,
skipped or cancelled authorization prevents every plan job from starting; failed
detection also prevents planning even if it already emitted `has-changes=true`. Enabled roots still execute their own Terraform providers, modules,
external data programs, and lock files with their root credentials. The allowlist
is a CI-side control, not a cloud IAM boundary: roles need their own trust
conditions. A dispatch with the right PR number and a bad head SHA can cancel an
in-flight run in the same concurrency group before validation.

The two workflows intentionally duplicate the plan pipeline. The drift guard in
`.github/tfman/tests/workflows/pr-review-dispatch.test.mjs` splits `plan.steps` at every step list item, including unnamed `uses` steps,
and compares all remaining text. It asserts exactly two cache steps and one
checkout ref line were removed, and a mutation test rejects an extra unnamed step. Its only allowed differences are the dispatch checkout `ref`
(and its `with` mapping) and the two PRReview cache steps, `Cache Terraform Providers`
and `Cache TFLint plugins`. Update security-relevant steps in both files together;
do not broaden the exceptions to hide drift.

Options: `--base <branch>` (default `main`), `--keep` (retain the PR and remote branch), `--skip-apply` (skip authorized apply), `--timeout <seconds>` (per wait, default `900`), and `-h`/`--help`. The opt-in `--toggle-appliers` tests unauthorized apply by temporarily changing the repository's `APPLIERS` variable to `[]`; the original value is restored after the scenario and by an exit trap on failure. This option requires access to read and write that variable. The opt-in `--cleanup-only` runs last: it restores both fixtures from the base and commits a unique root marker, then verifies successful cleanup removes all plan summaries while preserving apply comments.

None of `scripts/e2e-prcomment.sh`, `environments/`, or `.github/tfman/tests/` ship to consumer repos.

## Distribution boundaries

Keep the current copy-based distribution. Workflow YAML owns events, permissions,
job dependencies and third-party actions. Libraries own target selection and pure
output formatting; CLI entry points handle arguments and standard/file output.
GitHub integration adapters belong in `gh-scripts/`.

For `detect-changes`, `select-targets`, and `operate-command`, the CLI emits JSON
and `gh-scripts/write-outputs.mjs` reads that JSON from stdin and writes workflow
outputs to `GITHUB_OUTPUT`. Matrix construction is shared library logic; the adapter
owns the environment-file side effect. Workflows use Bash `pipefail` to preserve
CLI failures across the pipe. `write-result` retains its existing GitHub Summary
and output handling; this boundary change does not migrate every existing side effect.

Target-selection operations accept an explicit workspace independently of where
tfman is installed, without changing the process working directory.

Preserve existing CLI stdout, file output and error contracts when adding entry
points. Separate-placement CLI tests exercise code outside the consumer workspace.
A future public Action can wrap these interfaces; no Action metadata or reusable
workflow is required for the current distribution.
