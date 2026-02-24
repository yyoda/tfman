# GitHub Configuration & Operational Tools

This document consolidates the documentation for GitHub Actions Workflows and the CLI scripts used within this repository.

---

## GitHub Actions Workflows

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
    - **Execution User Restriction**: The executor (`github.actor`) must be included in `TF_APPLY_USERS`. If not defined, the workflow is skipped.

### PRComment
- **PURPOSE**:
    - Triggers `terraform apply` or `terraform plan` for changes when an arbitrary message is posted to a PR comment.
- **MESSAGE COMMANDS**:
    - **`$terraform apply [targets...]`**
        - Executes `terraform apply`.
        - If targets are omitted, applies all detected changes.
        - Example: `$terraform apply`, `$terraform apply dev/frontend dev/backend`
    - **`$terraform plan [targets...]`**
        - Executes `terraform plan`.
        - Example: `$terraform plan`, `$terraform plan dev/frontend`
- **CONDITIONS**:
- **Execution User Restriction**: The comment poster must be included in `TF_APPLY_USERS`. If not defined, the workflow is skipped.

### DriftDetection
- **PURPOSE**:
    - Regularly executes `terraform plan` for all environments to detect discrepancies (Drift) between the code and the actual environment. It can also be executed manually.
- **BEHAVIOR**:
    - Executes `plan` for all directories defined in `.tfdeps.json`.
    - When a difference (Drift) is detected or an error occurs, the Workflow status becomes failed and a notification is sent.

---

### Operations & Configuration

#### Execution User Restriction (`TF_APPLY_USERS`)
`manual-ops.yml` and `pr-comment.yml` restrict executable users because they have powerful privileges.

> [!IMPORTANT]
> This variable is mandatory for `ManualOps` and `PRComment` features to work. If `TF_APPLY_USERS` is missing or empty, these workflows will always be skipped (disabled).

The following variable must be registered in the GitHub repository settings (`Settings > Secrets and variables > Actions > Variables`).
- **Name**: `TF_APPLY_USERS`
- **Value**: A **JSON array** of allowed GitHub usernames. Example: `["user1", "user2", "admin-user"]`

#### Version Management
A `.terraform-version` file must exist in all working directories.

#### Required Environment Variables (`.env.ci`)
When executing each job, if a `.env.ci` file exists in the working directory, it is automatically loaded.

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
- `pr-review/report.mjs`: Used in the `PRReview` workflow. Aggregates results from multiple parallel `terraform plan` jobs and posts them as a single consolidated comment on the Pull Request.
- `pr-comment/report.mjs`: Used in the `PRComment` workflow. Formats the output of `terraform apply` executions and posts a report comment back to the PR.

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
node .github/scripts/cli/index.mjs generate-deps [--output <path>] [--ignore-file <path>]
```

- `--output`: Path to the output JSON file (Default: `.tfdeps.json` in workspace root).
- `--ignore-file`: Path to the ignore file (Default: `.tfdepsignore` in workspace root).

#### 2. `detect-changes`

Compares two Git commits (base and head) to identify changed files and maps them to affected Terraform roots using the dependency graph.

**Usage:**
```bash
node .github/scripts/cli/index.mjs detect-changes --base <sha> --head <sha> [--deps-file <path>] [--output <path>]
```

- `--base`: Base commit SHA.
- `--head`: Head commit SHA.
- `--deps-file`: Path to the dependency graph file (Default: `.tfdeps.json`).
- `--output`: Path to the output JSON file (Default: `.tfchanges.json` in workspace root).

#### 3. `select-targets`

Validates a list of target directories against the known roots in `.tfdeps.json` and formats them for a GitHub Actions matrix.

**Usage:**
```bash
node .github/scripts/cli/index.mjs select-targets --targets "dir1 dir2" [--output <path>]
```

- `--targets`: Space-separated list of target directories.
- `--output`: Path to the output JSON file (Default: `.tfmatrix.json` in workspace root).

#### 4. `prepare-custom-command`

Parses a PR command comment (e.g., `/apply app/dev`) and prepares the execution context.

**Usage:**
```bash
node .github/scripts/cli/index.mjs prepare-custom-command \
  --comment-body "<body>" \
  --base-sha <sha> \
  --head-sha <sha>
```

### Configuration Files

#### `.tfdeps.json`
Generated by `generate-deps`. Maps each Terraform root to its local module dependencies and provider requirements.

#### `.tfdepsignore`
List of glob patterns to exclude from dependency scanning.

### Development

Tests are located in `.github/tests`. Run tests using the node test runner.

```bash
node --test .github/tests/**/*.test.mjs
```
