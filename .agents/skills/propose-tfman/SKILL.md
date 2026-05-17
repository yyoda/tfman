---
name: propose-tfman
description: From inside the tfman repository, open a pull request against another GitHub repository that mirrors `.github/scripts` and `.github/workflows` into it. Use when the user wants to roll the *current* tfman tree out to a different repo end-to-end — clone the target, branch, copy from the local tfman checkout, commit, push, and `gh pr create` — for prompts like "tfman を myorg/foo に PR で提案して", "tfman の最新を別リポジトリに反映する PR を作って", "open a PR to roll out tfman to owner/repo", "deploy tfman to <repo>".
---

# propose-tfman

This skill rolls the **local tfman checkout** out to a different repository by opening a pull request. It is designed to be invoked from inside the tfman repository — the source files come from the working tree you already have, no upstream clone, no fork URL juggling.

Companion skill: `install-tfman` (does the same copy but into CWD instead of a remote target).

Pipeline: validate local tfman → clone target → branch off the target's default branch → copy `.github/scripts/` and `.github/workflows/` from the local tfman → commit → push → `gh pr create`.

## Procedure

### Step 1 — Run the script

```bash
<skill-dir>/scripts/propose.sh <owner/repo>
```

The argument must be in `owner/repo` form (e.g., `myorg/infra`). `<skill-dir>` is the directory containing this `SKILL.md`. The script:

1. Resolves the source tfman checkout (default: `<skill-dir>/../../..`, which is the tfman repo that hosts this skill). Verifies that `.github/scripts/` and `.github/workflows/` exist there. If the source's git working tree has uncommitted edits under those paths, prints a warning and continues.
2. Clones the target into `<skill-dir>/tmp/work/<owner>__<repo>/` via `gh repo clone`, or refreshes it if already present.
3. Detects the target's default branch (`gh repo view --json defaultBranchRef`).
4. Hard-resets the local target clone to `origin/<base>`, then creates `chore/tfman-update-<UTC-timestamp>` from it.
5. Copies `.github/scripts/` and `.github/workflows/` from the **local tfman tree** into the target.
6. Stages those two paths and **exits cleanly with "No changes" if the staged diff is empty** — the target is already in sync, no PR is opened.
7. Otherwise commits with a message recording the local tfman short SHA, pushes the branch, and opens a PR with `gh pr create` against the detected base branch.

The default branch name is timestamped so re-runs do not collide on the remote.

### Step 2 — Hand back to the user

If a PR was created, the script prints the URL. Echo that URL to the user and note that:

- The PR diff covers only `.github/scripts/` and `.github/workflows/`. Other tfman adoption pieces (`environments/` layout, `.terraform-version`, env files, `.tfdeps.json`, `APPLIERS`, branch protection) are listed in the tfman README under "Adopting This in Your Repository" — those are out of scope and must be done separately.
- Same-named workflow files in the target were overwritten. The user should skim the PR diff for any local customizations that were clobbered.

If the script reported "No changes" instead, tell the user the target is already at the local tfman HEAD and nothing was proposed.

If the script printed an "uncommitted changes" warning at the start, mention that the PR contains those local edits even though the recorded SHA points at HEAD before them — the user may want to commit upstream first for clean attribution.

## Knobs

All optional, controlled via env vars (no flags, to keep the surface area small):

| Var | Effect | Default |
|---|---|---|
| `TFMAN_SRC_DIR` | Path to a tfman checkout to read from | The tfman repo that hosts this skill (`<skill-dir>/../../..`) |
| `PROPOSE_BASE_BRANCH` | Override the target's base branch | detected via `gh repo view` |
| `PROPOSE_DRY_RUN` | If set to any non-empty value, skip the push and `gh pr create` (still commits locally so the user can inspect `<skill-dir>/tmp/work/...`) | unset |

## Preconditions

- The script is invoked from a copy of this skill living inside a tfman checkout (so the default source resolution works), **or** `TFMAN_SRC_DIR` points at one.
- `gh` is installed and authenticated (`gh auth status`) against an account that can push to the target and open PRs.
- `git` has `user.name` / `user.email` configured (global is fine; the cloned target inherits global config).
- Network access to GitHub.

If `gh` is not authenticated, the clone or PR-create step will fail with gh's own error — surface that output to the user and ask them to run `gh auth login`.

## Error handling

- **exit 2**: bad invocation (no argument, target not in `owner/repo` form, or the resolved source lacks `.github/scripts` / `.github/workflows`). The script prints a usage banner and/or a "not a tfman checkout" message.
- **exit 3**: `<skill-dir>/tmp/work/<...>/` exists without `.git` (leftover from an interrupted run). Tell the user to remove that directory manually and re-run.
- **Any other non-zero exit**: `trap ERR` printed the failing line and command to stderr — pass that output to the user as-is.

## Re-running

The target clone is persistent at `<skill-dir>/tmp/work/<owner>__<repo>/`. Subsequent runs `git fetch` instead of re-cloning, which is much faster. To wipe the cache, delete that directory.

Because the default branch name embeds a UTC timestamp, repeated invocations do not collide on the remote — each run produces a fresh branch/PR.
