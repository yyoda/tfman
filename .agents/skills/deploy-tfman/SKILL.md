---
name: deploy-tfman
description: From inside the tfman repository, open a pull request against another GitHub repository that mirrors `.github/scripts` and `.github/workflows` into it. Use when the user wants to roll the *current* tfman tree out to a different repo — for prompts like "tfman を myorg/foo に PR で提案して", "tfman の最新を別リポジトリに反映する PR を作って", "open a PR to roll out tfman to owner/repo", "deploy tfman to <repo>".
---

# deploy-tfman

This skill rolls the **local tfman checkout** out to a different repository by opening a pull request. It is designed to be invoked from inside the tfman repository — the source files come from the working tree you already have.


## Procedure

### Step 1 — Confirm the target

Ask the user for the target repository in `owner/repo` form (e.g. `myorg/infra`) if not already provided.

### Step 2 — Confirm the source tfman checkout

```bash
SOURCE_ROOT="${TFMAN_SRC_DIR:-<skill-dir>/../../..}"
```

`<skill-dir>` is the directory containing this `SKILL.md`. The default resolves to the tfman repo that hosts this skill.

Verify the source looks like a tfman checkout:

```bash
[ -d "$SOURCE_ROOT/.github/scripts" ] && [ -d "$SOURCE_ROOT/.github/workflows" ]
```

If either directory is missing, stop and tell the user to set `TFMAN_SRC_DIR` to a valid tfman checkout.

Get the source SHA and check for uncommitted changes:

```bash
SOURCE_SHA=$(git -C "$SOURCE_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")
git -C "$SOURCE_ROOT" status --porcelain -- .github/scripts .github/workflows
```

If there are uncommitted changes, warn the user that the PR will include them even though `$SOURCE_SHA` points at the clean HEAD, then continue.

### Step 3 — Prepare a local clone of the target

```bash
WORK_DIR="<skill-dir>/tmp/work/${TARGET//\//__}"
```

- If `$WORK_DIR/.git` exists → `git -C "$WORK_DIR" fetch --prune origin`
- If `$WORK_DIR` exists without `.git` → tell the user to remove it manually and stop
- Otherwise → `gh repo clone "$TARGET" "$WORK_DIR"`

### Step 4 — Detect the base branch

```bash
BASE=$(gh repo view "$TARGET" --json defaultBranchRef --jq .defaultBranchRef.name)
```

### Step 5 — Create a working branch

```bash
git -C "$WORK_DIR" checkout -B "$BASE" "origin/$BASE"
BRANCH="chore/tfman-update-$(date -u +%Y%m%d-%H%M%S)"
git -C "$WORK_DIR" checkout -b "$BRANCH"
```

The timestamp suffix prevents collisions if the skill is run more than once against the same target.

### Step 6 — Copy the files

```bash
mkdir -p "$WORK_DIR/.github/scripts" "$WORK_DIR/.github/workflows"
cp -R "$SOURCE_ROOT/.github/scripts/." "$WORK_DIR/.github/scripts/"
cp -R "$SOURCE_ROOT/.github/workflows/." "$WORK_DIR/.github/workflows/"
```

### Step 7 — Check for changes

```bash
git -C "$WORK_DIR" diff -- .github/scripts .github/workflows
```

If the diff is empty (target already matches the source), tell the user the target is already in sync with `tfman@$SOURCE_SHA` and stop — no PR is needed.

### Step 8 — Commit

```bash
git -C "$WORK_DIR" add .github/scripts .github/workflows
git -C "$WORK_DIR" commit -m "chore: sync tfman scripts & workflows ($SOURCE_SHA)"
```

### Step 9 — Push

```bash
git -C "$WORK_DIR" push -u origin "$BRANCH"
```

### Step 10 — Open the PR

```bash
gh pr create \
  --repo "$TARGET" \
  --base "$BASE" \
  --head "$BRANCH" \
  --title "chore: sync tfman scripts & workflows ($SOURCE_SHA)" \
  --body "Sync \`.github/scripts\` and \`.github/workflows\` from tfman@$SOURCE_SHA.

Review notes:
- Same-named workflow files in the target were overwritten — verify any local customizations you wanted to keep.
- Other adoption pieces (\`environments/\`, \`.terraform-version\`, env files, \`.tfdeps.json\`, \`APPLIERS\`, branch protection) are out of scope and must be done separately (see the tfman README)."
```

### Step 11 — Report to the user

Echo the PR URL. Note that:

- The diff covers only `.github/scripts/` and `.github/workflows/`.
- Same-named workflow files were overwritten — the user should skim the PR diff for clobbered customizations.

## Knobs

| Var | Effect | Default |
|---|---|---|
| `TFMAN_SRC_DIR` | Path to a tfman checkout to read from | The tfman repo that hosts this skill (`<skill-dir>/../../..`) |

## Preconditions

- Invoked from inside a tfman checkout, **or** `TFMAN_SRC_DIR` points at one.
- `gh` is installed and authenticated (`gh auth status`) against an account that can push to the target and open PRs. If not, surface gh's error and ask the user to run `gh auth login`.
- `git` has `user.name` / `user.email` configured (global is fine).
- Network access to GitHub.

## Error handling

- **Source validation fails**: stop and tell the user to set `TFMAN_SRC_DIR`.
- **`$WORK_DIR` exists without `.git`**: ask the user to remove it manually and re-run.
- **Any command fails**: surface the error output to the user as-is and stop.

## Re-running

The target clone is cached at `<skill-dir>/tmp/work/<owner>__<repo>/`. Subsequent runs only `git fetch` the delta instead of re-cloning. To reset, delete that directory.
