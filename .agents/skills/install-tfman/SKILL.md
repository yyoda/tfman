---
name: install-tfman
description: Sync `.github/scripts` and `.github/workflows` from yyoda/tfman into the user's repository to adopt or refresh the tfman Terraform CI/CD pipeline. Use for requests like "install tfman" / "set up tfman" / "update tfman" / "tfman を導入" / "tfman をアップデート".
---

# install-tfman

This skill does exactly one thing: copy **`.github/scripts/`** and **`.github/workflows/`** from `yyoda/tfman` into the user's current repository. Same procedure for initial install and for updates.

## Procedure

### Step 1 — Run the script

Run the bundled `scripts/install.sh` from the CWD of the user's target repository:

```bash
<skill-dir>/scripts/install.sh
```

If the script exits non-zero, report the output to the user and stop (see "Error handling" below for exit-code-specific guidance).

`<skill-dir>` is the absolute path of the directory containing this `SKILL.md`. The script performs:

1. Inspect `<skill-dir>/tmp/tfman/`:
   - has `.git` → `git fetch --depth=1 origin HEAD` + `reset --hard FETCH_HEAD`
   - exists but no `.git` (leftover from an interrupted run) → exit 3 and ask the user to remove it manually
   - missing → `git clone --depth=1`
2. `cp -R` `.github/scripts/` into the CWD
3. `cp -R` `.github/workflows/` into the CWD

File preservation:

- The user's own workflows under `.github/workflows/` survive `cp -R`'s merge behavior **as long as they don't share a filename with a tfman workflow**. Same-named files are overwritten, which is why Step 2 always shows the diff.
- Out-of-scope subtrees like `.github/env.d/` are untouched — the script never copies into them.

**Idempotency**: Re-running against the same upstream revision produces the same target state. `<skill-dir>/tmp/` is intentionally not cleaned up; the second run onward only `git pull`s the delta.

**Failure behavior**: `set -euo pipefail` + `trap ERR` halts the script at the first failure and prints the line, command, and exit code to stderr. The script does not try to self-heal a half-finished state — surface the report so the user can decide what to do.

### Step 2 — Hand back to the user

Show `git status` and `git diff -- .github/scripts .github/workflows` so the user can see what was added or changed. Call out workflow files that look like they had local customizations — the user needs to verify nothing important was clobbered.

Example message:

> Installed `.github/scripts/` and `.github/workflows/` from tfman. Use `git diff` to check whether any of your workflow customizations were overwritten. The remaining adoption steps (`environments/` layout, `.terraform-version`, `.env` files, generating `.tfdeps.json`, the `APPLIERS` variable, branch protection) are documented in the tfman README under "Adopting This in Your Repository".

Don't auto-commit. Let the user review the diff and stage/commit on their own terms.

## Error handling

- **exit 3**: `<skill-dir>/tmp/tfman/` has leftover state without `.git`. Tell the user to remove that directory manually and re-run.
- **Any other non-zero exit**: `trap ERR` has already printed the failing line + command to stderr — pass that output to the user as-is.

## Overriding the upstream repository

The `TFMAN_REPO_URL` variable at the top of the script can be overridden via env var, for forks or mirrors:

```bash
TFMAN_REPO_URL=git@github.com:myorg/tfman-fork.git \
<skill-dir>/scripts/install.sh
```

Normally no override is needed.
