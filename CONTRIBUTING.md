# Contributing to tfman

This document covers maintainer-only tooling and workflows: things that exist to develop and validate tfman itself, but are **not** part of what gets shipped to consumer repositories via the `deploy-tfman` skill.

For consumer-facing documentation (the workflows and CLI that actually ship), see [`.github/workflows/README.md`](.github/workflows/README.md).

---

## What actually ships to consumer repos

`deploy-tfman`'s `SKILL.md` (Step 6, `WORKFLOW_FILES`) is the single source of truth for which workflow files are distributed — check it before assuming a workflow you add under `.github/workflows/` will be rolled out automatically. As of this writing that list is `drift-detection.yml`, `manual-ops.yml`, `pr-comment.yml`, `pr-review.yml`, and `README.md`.

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
- End-to-end tests: run `bash scripts/e2e-prcomment.sh` locally from a checkout with no tracked changes, an `origin` remote, and authenticated `gh`. The script requires only Bash, `gh`, `jq`, `git`, `sed`, `date`, and `sleep`. It creates a temporary branch and draft PR on the current repository, exercises PRReview plans, ignored comments, PRComment plans, early cancellation, apply, and a broken formatting fixture, then posts a results table and closes the PR. It restores the original local branch and deletes the local test branch. The fixtures under `environments/` exist for this testing; `test1` and `test2` use only null/random providers and need no cloud credentials. Authorized apply requires the developer's login in `APPLIERS` and changes the fixture state.

The e2e script uses the developer's local `gh` authentication because PRs and comments created by Actions with `GITHUB_TOKEN` do not trigger the corresponding `pull_request`/`issue_comment` workflows. Run it without concurrent PRComment activity: issue-comment runs use the default branch, so it selects the newest run after each command across the repository. Early cancellation is timing-sensitive and fails its assertions if an artifact is already produced.

Options: `--base <branch>` (default `main`), `--keep` (retain the PR and remote branch), `--skip-apply` (skip authorized apply), `--timeout <seconds>` (per wait, default `900`), and `-h`/`--help`. The opt-in `--toggle-appliers` tests unauthorized apply by temporarily changing the repository's `APPLIERS` variable to `[]`; the original value is restored after the scenario and by an exit trap on failure. This option requires access to read and write that variable.

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
