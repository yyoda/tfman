---
name: tfman-setup
description: Install or update the tfman Terraform-on-GitHub-Actions pipeline (yyoda/tfman) inside the user's repository. Use this skill whenever the user wants to "set up tfman", "introduce tfman to this repo", "adopt tfman", "tfman を導入したい", "tfman をアップデート", "update tfman / sync tfman from upstream", or whenever the user mentions wiring up Terraform CI/CD with PR plan comments / drift detection / ChatOps apply on a fresh repo, or mentions copying / refreshing the `.github/` directory from yyoda/tfman. Also use when the user asks how to bring a repo onto the tfman pipeline, or when they say things like "make this repo use the tfman workflows" or "pull the latest tfman workflows in".
---

# tfman setup & update

`tfman` (github.com/yyoda/tfman) is a reference GitHub Actions pipeline for Terraform monorepos — dependency-aware change detection, parallel matrix plans, PR comment plans, ChatOps apply, drift detection. Adopting it means copying its `.github/` directory into the target repo plus a handful of one-time configuration steps.

The README walks a human through 8 steps. That's tedious. Your job is to drive those steps for the user instead — ask only the minimum needed, then do the rest yourself.

## When to use which flow

Decide first which flow applies — they share machinery but the steps differ:

- **Initial install** — target repo has no `.github/workflows/PRReview.yml` (or no `.tfdeps.json`). Go through [Initial install](#initial-install).
- **Update existing** — target repo already has tfman wired in and the user wants newer workflows / CLI. Go through [Update tfman from upstream](#update-tfman-from-upstream).

Quick probe before deciding:

```bash
test -f .github/workflows/PRReview.yml && echo "tfman present" || echo "fresh repo"
test -f .tfdeps.json && cat .tfdeps.json | head -5
```

## Initial install

The README's 8 steps, condensed. Don't re-explain to the user; just execute and report.

### Step 0 — Pre-flight checks

Run these in parallel and report anything missing:

```bash
node --version          # need 18+, 20+ preferred
terraform -version      # any Terraform CLI
git rev-parse --show-toplevel   # confirm we're in a git repo
gh auth status          # optional — only if you'll later help with APPLIERS / rulesets
```

If Node < 18, stop and tell the user to upgrade Node first. Other tools missing is fine — note it and continue.

### Step 1 — Fetch tfman's `.github/` from upstream

Clone tfman to a tmp dir (shallow), copy `.github/` into the repo, then delete the tmp.

```bash
TMP=$(mktemp -d)
git clone --depth=1 https://github.com/yyoda/tfman.git "$TMP/tfman"
# Preserve any existing .github content the target repo already has by merging,
# but warn loudly if there are file collisions.
mkdir -p .github
cp -R "$TMP/tfman/.github/." .github/
rm -rf "$TMP"
```

If the target repo already has `.github/workflows/*.yml` belonging to *its own* workflows (CI, lint, release), those are preserved — `cp -R` only overwrites files with matching names. After copying, list `.github/workflows/` and confirm with the user which workflows survived if anything looks ambiguous.

Why a fresh clone every time: the user picked GitHub clone over local copy because it stays current with upstream fixes.

### Step 2 — Identify Terraform roots

Look for Terraform code in the target repo:

```bash
find . -name '*.tf' -not -path './.git/*' -not -path '*/\.terraform/*' | head -50
```

Two cases:

- **The repo already has Terraform code.** Identify candidate root directories (a "root" is a directory holding `*.tf` files that's meant to be applied directly, typically containing `provider` / `terraform` / `backend` blocks). Ask the user to confirm the list of roots if it's non-obvious. Each root must move under `environments/<name>/` per the tfman convention if it isn't already — but **do not move directories without explicit user approval**, since that breaks state/import paths.
- **The repo has no Terraform code yet.** Ask the user which environment names they want bootstrapped (e.g. `dev`, `staging`, `prod`) and create empty `environments/<name>/` stubs with a minimal `main.tf` placeholder.

### Step 3 — Pin Terraform version per root

For each root under `environments/`, ensure `.terraform-version` exists. **Roots without this file are silently ignored by the pipeline** — this is the single most common adoption mistake, so be deliberate.

```bash
for d in environments/*/; do
  if [ ! -f "$d.terraform-version" ]; then
    echo "MISSING: $d.terraform-version"
  fi
done
```

If `.terraform-version` is missing, ask the user which version (default to a current stable like `1.9.8` if they shrug, but confirm — pinning is the point of the file). Then write it:

```bash
echo "1.9.8" > environments/<name>/.terraform-version
```

### Step 4 — Cloud auth via `.env` files

For each environment, create `.github/env.d/environments/<name>/.env` with the right OIDC config. Ask the user which cloud each environment uses (AWS / Azure / GCP / mixed). The exact `.env` shape per cloud is in [references/env-files.md](references/env-files.md) — read that file before writing `.env`s.

Don't invent role ARNs or subscription IDs. If the user doesn't have them ready, write the `.env` with placeholder values clearly marked (`# TODO: fill in <thing>`) and tell the user which fields to fill before pushing.

If `.env` is missing for a root, the workflow logs a skip message and continues — so this step is technically optional, but the pipeline can't authenticate without it.

### Step 5 — Generate the dependency graph

```bash
node .github/scripts/cli/index.mjs generate-deps
```

This produces `.tfdeps.json`. Commit it. Re-run whenever an environment is added or removed.

If this command fails (commonly "module not found" type errors), `terraform init` may be required in each root first. Run `terraform init` per root, then retry:

```bash
for d in environments/*/; do (cd "$d" && terraform init -backend=false); done
node .github/scripts/cli/index.mjs generate-deps
```

`-backend=false` skips remote backend init (which would need real credentials just to scan deps).

### Step 6 — `APPLIERS` GitHub repository variable

This must be set in GitHub Settings — it's a repo variable, not a file. You can't edit it directly. You have two options:

- If `gh` CLI is authenticated and the user has admin on the repo, set it for them:

  ```bash
  gh variable set APPLIERS --body '["<github-username>"]'
  ```

  Ask which usernames before running. Confirm before executing — this is a permission grant.

- Otherwise, print the exact steps for the user: **Settings → Secrets and variables → Actions → Variables → New variable → `APPLIERS` → `["<your-username>"]`**.

If `APPLIERS` is unset, *all* apply operations are blocked (planner-only mode). Make sure the user knows that's the default.

### Step 7 — Branch protection (recommend, don't enforce)

Tell the user to enable "Require branches to be up to date before merging" on the main branch (Settings → Rules → Rulesets, or classic Branch protection). This prevents merging stale plans.

Don't try to set this via API unless the user asks — it's a policy decision and varies by org.

### Step 8 — Optional Slack subscription

If the user wants Slack notifications, give them the `/github subscribe` command verbatim:

```
/github subscribe <org>/<repo> workflows:{name: "DriftDetection,PRReview,ManualOps,PRComment"}
```

### Step 9 — Commit and verify

Stage everything tfman-related and create a single setup commit:

```bash
git add .github/ .tfdeps.json environments/
git status
```

Show `git status` to the user before committing. Default commit message: `chore: adopt tfman pipeline`. Ask if they want to commit now or review first.

After committing, quickly summarize what's left for the user to do manually:
- Fill any `# TODO` placeholders in `.env` files
- Set `APPLIERS` (if you couldn't via `gh`)
- Enable branch protection rule
- Optionally subscribe Slack
- Push and open a test PR — the `PRReview` workflow should fire and post a plan comment

## Update tfman from upstream

When the user wants to refresh workflows/CLI from `yyoda/tfman`. The target repo's own Terraform code and `.tfdeps.json` stay untouched; only the pipeline files change.

```bash
TMP=$(mktemp -d)
git clone --depth=1 https://github.com/yyoda/tfman.git "$TMP/tfman"

# Compare what would change
diff -rq .github/workflows "$TMP/tfman/.github/workflows" || true
diff -rq .github/scripts   "$TMP/tfman/.github/scripts"   || true
diff -rq .github/actions   "$TMP/tfman/.github/actions"   2>/dev/null || true
```

Show the diff summary to the user before overwriting. Then:

```bash
# These three subtrees are tfman-owned and safe to replace wholesale.
# DO NOT touch .github/env.d/ — that's user-owned per-env config.
rm -rf .github/workflows .github/scripts .github/actions 2>/dev/null
cp -R "$TMP/tfman/.github/workflows" .github/
cp -R "$TMP/tfman/.github/scripts"   .github/
cp -R "$TMP/tfman/.github/actions"   .github/ 2>/dev/null || true
rm -rf "$TMP"
```

Why `env.d/` is excluded: it holds per-environment `.env` files written by the user. Replacing it would nuke their cloud auth config.

After updating, re-run `generate-deps` since the CLI itself may have changed in a way that produces a different `.tfdeps.json` shape:

```bash
node .github/scripts/cli/index.mjs generate-deps
git diff -- .tfdeps.json
```

Show the diff. If it's empty, great. If it changed, that's expected — commit it with the workflow update.

Commit message suggestion: `chore: sync tfman pipeline from upstream`.

## General principles

- **Don't ask questions that have observable answers.** Probe the filesystem first.
- **Don't move user files without confirmation.** Especially Terraform roots — moving them can break state addresses or backend keys.
- **Echo the README's "why" in your own communication when it matters.** E.g., "without `.terraform-version`, the pipeline will silently skip this env" — that's the kind of trip-wire the user needs to know about.
- **One commit per logical step.** Initial install = one commit. Update = one commit. Don't sprinkle WIP commits.
- **Stop and ask if you find unexpected state.** A pre-existing `.tfdeps.json` with a different shape, a `.github/workflows/` with files that look custom, an `environments/` directory that already exists with non-Terraform content — none of these should be silently overwritten.
