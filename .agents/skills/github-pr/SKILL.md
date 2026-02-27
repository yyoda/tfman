---
name: github-pr
description: Automate GitHub pull request creation from git changes. Use when the user wants to create a PR, submit changes for review, or open a pull request on GitHub. Handles branch detection, PR title and body generation from git diff/log, and optional reviewer and label assignment via the gh CLI.
---

# GitHub PR

Automate GitHub PR creation from current git changes.

## Workflow

### 1. Gather context

Run these in parallel:

```bash
git status
git log main..HEAD --oneline          # commits since base branch
git diff main..HEAD --stat            # files changed
```

Determine:
- Current branch name
- Base branch (default: `main`)
- Whether there are unpushed commits (`git push -u origin HEAD` if needed)

### 2. Generate PR content

**Title**: Derive from the most descriptive commit message or branch name. Use conventional commit style when appropriate (e.g., `feat: add user auth`, `fix: resolve null pointer in parser`). Keep under 72 characters.

**Body**: Use the template in [references/pr-template.md](references/pr-template.md). Fill in each section based on the actual diff and commit messages.

### 3. Create the PR

```bash
gh pr create \
  --title "<title>" \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```

Add optional flags as needed:

| Intent | Flag |
|---|---|
| Set reviewers | `--reviewer <username>,<username>` |
| Set labels | `--label <label>` |
| Set base branch | `--base <branch>` |
| Draft PR | `--draft` |

### 4. Confirm

After creation, output the PR URL. If the user requested reviewers or labels, confirm they were set.

## Notes

- If `gh` is not authenticated, instruct the user to run `gh auth login`.
- If the branch has no upstream, push it first: `git push -u origin HEAD`.
- Read [references/pr-template.md](references/pr-template.md) to fill in the PR body.
