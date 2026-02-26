# GitHub Configuration & Operational Tools for Terraform CI/CD

This document consolidates the documentation for GitHub Actions Workflows and the CLI scripts used within this repository.

---

## GitHub Actions Workflows

## Recommended: Reusable Workflows (minimal YAML in your repo)

This repository now provides reusable workflows (triggered by `workflow_call`).

In your own repository, you only keep small wrapper workflow files (triggers + guards) and call the reusable workflows from `yyoda/tfman`.

Key points for OSS/public repos:
- **Fork PRs are skipped** for `PRReview` (OIDC + real backends are not safe for untrusted forks).
- `PRComment` (ChatOps) is restricted to **`OWNER`/`MEMBER`/`COLLABORATOR`** by default.
- You still must commit `.tfdeps.json` and place `.terraform-version` in every Terraform root.

### Wrapper examples

`PRReview` wrapper (place in your repo as `.github/workflows/pr-review.yml`):

```yaml
name: PRReview

on:
    pull_request:
        types: [opened, synchronize, reopened]
        branches: [main]

permissions:
    id-token: write
    contents: read
    pull-requests: write

jobs:
    call:
        # Skip untrusted fork PRs
        if: github.event.pull_request.head.repo.full_name == github.repository
        uses: yyoda/tfman/.github/workflows/reusable-pr-review.yml@v1
        with:
            pr_number: ${{ github.event.pull_request.number }}
            base_sha: ${{ github.event.pull_request.base.sha }}
            head_sha: ${{ github.event.pull_request.head.sha }}
            tfman_ref: v1
        secrets: inherit
```

`PRComment` wrapper (place in your repo as `.github/workflows/pr-comment.yml`):

```yaml
name: PRComment

on:
    issue_comment:
        types: [created]

permissions:
    id-token: write
    contents: read
    pull-requests: write
    statuses: write

jobs:
    call:
        if: >-
            github.event.issue.pull_request &&
            startsWith(github.event.comment.body, '$terraform') &&
            (github.event.comment.author_association == 'OWNER' || github.event.comment.author_association == 'MEMBER' || github.event.comment.author_association == 'COLLABORATOR')
        uses: yyoda/tfman/.github/workflows/reusable-pr-comment.yml@v1
        with:
            pr_number: ${{ github.event.issue.number }}
            comment_body: ${{ github.event.comment.body }}
            comment_id: ${{ github.event.comment.id }}
            tfman_ref: v1
        secrets: inherit
```

`ManualOps` wrapper (place in your repo as `.github/workflows/manual-ops.yml`):

```yaml
name: ManualOps

on:
    workflow_dispatch:
        inputs:
            targets:
                description: 'Target directories (space-separated)'
                required: true
                type: string
            command:
                description: 'Terraform command to execute'
                required: true
                type: choice
                options: [plan, apply]
                default: apply

permissions:
    id-token: write
    contents: read

jobs:
    call:
        uses: yyoda/tfman/.github/workflows/reusable-manual-ops.yml@v1
        with:
            targets: ${{ inputs.targets }}
            command: ${{ inputs.command }}
            tfman_ref: v1
        secrets: inherit
```

`DriftDetection` wrapper (place in your repo as `.github/workflows/drift-detection.yml`):

```yaml
name: DriftDetection

on:
    schedule:
        - cron: '0 0 * * 1'
    workflow_dispatch:

permissions:
    id-token: write
    contents: read

jobs:
    call:
        uses: yyoda/tfman/.github/workflows/reusable-drift-detection.yml@v1
        secrets: inherit
```

### PRReview
- **PURPOSE**:
    - Determines Terraform execution paths and posts the results of `terraform plan` as a comment when a PR is created or updated.
- **BEHAVIOR**:
    - Identifies changed directories based on the diff between the base branch and the head branch.
    - Uses scripts under `.github/scripts/cli` for change detection.
    - Runs `terraform plan` in parallel for each detected directory and saves the results as artifacts.
    - Finally, collects all results from artifacts and posts them in a comment. This flow is used to consolidate reports into a single post.
    - To prevent comment clutter from new commits, old posts are deleted each time a new comment is posted.

### ManualOps
- **PURPOSE**:
    - Manually executes `terraform apply` for specific directories using workflow_dispatch. Multiple directories can be specified.
- **INPUT PARAMETERS**:
    - `targets`: Directory paths to apply (space-separated). Example: `app/dev app/prod`
    - `command`: The command to execute. The default is `apply`, but `plan` can be specified as an option.
- **CONDITIONS**:
    - **Execution User Restriction**: The executor (`github.actor`) must be listed in the `APPLIERS` repository variable. If not included, `terraform apply` is blocked.

### PRComment
- **PURPOSE**:
    - Triggers `terraform apply` or `terraform plan` when a PR comment starting with `$terraform` is posted.
- **MESSAGE COMMANDS**:
    - **`$terraform apply [targets...]`**
        - Executes `terraform apply`.
        - If targets are omitted, applies all detected changes.
        - Example: `$terraform apply`, `$terraform apply dev/frontend dev/backend`
    - **`$terraform plan [targets...]`**
        - Executes `terraform plan`.
        - Example: `$terraform plan`, `$terraform plan dev/frontend`
- **CONDITIONS**:
    - **Targets**: Must match Terraform root paths in `.tfdeps.json` (i.e., `dirs[].path`, relative to repo/workspace root).
    - **Execution User Restriction**: Users not listed in `APPLIERS` can run `plan` but `apply` is blocked.
    - **Public repo safety**: It's recommended to restrict ChatOps triggers to trusted users (e.g. `OWNER`/`MEMBER`/`COLLABORATOR`).

### DriftDetection
- **PURPOSE**:
    - Regularly executes `terraform plan` for all environments to detect discrepancies (Drift) between the code and the actual environment. It can also be executed manually.
- **BEHAVIOR**:
    - Executes `plan` for all directories defined in `.tfdeps.json`.
    - When a difference (Drift) is detected or an error occurs, the Workflow status becomes failed.
    - Notifications are optional (e.g., via GitHub Slack App workflow subscriptions; see **Slack Integration** below).

---

### Operations & Configuration

#### Execution User Restriction
`manual-ops.yml` and `pr-comment.yml` restrict executable users because they have powerful privileges.

User authorization is managed via the `APPLIERS` GitHub Actions repository variable.

**Role definitions:**

| Role | Description | Who gets it |
|---|---|---|
| `planner` | Can run `terraform plan` only | Default for all users not in `APPLIERS` |
| `applier` | Can run both `terraform plan` and `apply` | Users listed in the `APPLIERS` variable |

**`APPLIERS` variable** (Settings > Secrets and variables > Actions > Variables):

```json
["user1", "user2"]
```

- Add or remove GitHub usernames in this JSON array to grant or revoke `APPLIERS` permissions.
- If the variable is not set or the user is not listed, they default to the `planner` role (apply operations are blocked).

#### Version Management
A `.terraform-version` file must exist in all working directories.

#### Optional Environment Variables (`.env.ci`)
When executing each job, if a `.env.ci` file exists in the working directory, it is automatically loaded. If it does not exist, the workflow logs a skip message and continues.

#### Dependency Definition (`.tfdeps.json`)
`DriftDetection` and parts of the change detection logic depend on the `.tfdeps.json` file, which defines the directory structure and dependencies. If you add a new Terraform directory or delete one, you must update this file.

For update instructions, please refer to the **CLI Scripts** section below.

### Slack Integration
The following command is executed in the some channel. If you add a new workflow, you need to add the new workflow name to the command above and subscribe again.

```bash
/github subscribe org/repo workflows:{name: "DriftDetection,PRReview,ManualOps,PRComment"}
```

---

## GitHub Scripts (gh-scripts)

`.github/scripts/gh-scripts` contains scripts designed to be executed via `actions/github-script` within GitHub Actions workflows.

### Features
- **Actions Runtime Dependency**: Utilizes objects provided by the Actions runtime such as `github` (Octokit), `context`, and `core`.
- **Logic Separation**: Separates complex logic (e.g., PR comment formatting, artifact aggregation) from YAML files into JavaScript modules to keep workflows clean.

### Scripts
- `gh-scripts/post-comment.mjs`: Utility script for posting comments to Pull Requests. It handles formatting of `terraform plan` and `terraform apply` results, and aggregating reports from multiple matrix jobs.

## GitHub Scripts CLI

A CLI tool designed to manage Terraform operations within a monorepo structure, located in `.github/scripts/cli`. It is implemented in Node.js and integrates seamlessly with GitHub Actions.

### Features

- **Dependency Management**: Scans the workspace to build a dependency graph of Terraform modules (`.tfdeps.json`).
- **Change Detection**: Analyzes Git diffs against the dependency graph to determine which Terraform roots need re-planning.
- **Target Selection**: Filters and validates specific target directories for manual execution.
- **Command Management**: Parses PR comments to trigger specific Terraform operations.

### Prerequisites

- Node.js 18+ (20+ recommended)
- Terraform CLI (required for `generate-deps`)

### Usage

The CLI is invoked via the `index.mjs` entry point.

```bash
node .github/scripts/cli/index.mjs <command> [options]
```

### Commands

#### 1. `generate-deps`

Scans all directories containing `.terraform-version` (Terraform roots) and analyzes their module/provider usage.

**Usage:**
```bash
node .github/scripts/cli/index.mjs generate-deps [--output <path>] [--ignore-file <path>] [--root <path>]
```

- `--output`: Path to the output JSON file (Default: `.tfdeps.json` in workspace root).
- `--ignore-file`: Path to the ignore file (Default: `.tfdepsignore` in workspace root).
- `--root`: Path to the root directory to scan (Default: workspace root).

#### 2. `detect-changes`

Compares two Git commits (base and head) to identify changed files and maps them to affected Terraform roots using the dependency graph.

**Usage:**
```bash
node .github/scripts/cli/index.mjs detect-changes --base <sha> --head <sha> [--deps-file <path>] [--output <path>]
```

- `--base`: Base commit SHA.
- `--head`: Head commit SHA.
- `--deps-file`: Path to the dependency graph file (Default: `.tfdeps.json`).
- `--output`: If provided, writes `{ "include": [...] }` JSON to the given path. If omitted, prints JSON to stdout.

#### 3. `select-targets`

Validates a list of target directories against the known roots in `.tfdeps.json` and formats them for a GitHub Actions matrix.

**Usage:**
```bash
node .github/scripts/cli/index.mjs select-targets --targets "dir1 dir2" [--output <path>]
```

- `--targets`: Space-separated list of target directories.
- `--output`: If provided, writes `{ "include": [...] }` JSON to the given path. If omitted, prints JSON to stdout.

#### 4. `operate-command`

Parses a PR command comment (e.g., `$terraform apply app/dev`) and prepares the execution context.

**Usage:**
```bash
node .github/scripts/cli/index.mjs operate-command \
  --comment-body "<body>" \
  --base-sha <sha> \
  --head-sha <sha>
```

### Configuration Files

#### `.tfdeps.json`
Generated by `generate-deps`. Maps each Terraform root to its local module dependencies and provider requirements.

#### `.tfdepsignore`
Dependency scanning ignore rules.

- Format: whitespace-separated patterns. **Recommended:** one pattern per line.
- Blank lines are ignored.
- Lines starting with `#` are treated as comments.

Example:

```text
.git
.github
.terraform
node_modules
```

### Development

Tests are located in `.github/tests`. Run tests using the node test runner.

```bash
node --test .github/tests/**/*.test.mjs
```
