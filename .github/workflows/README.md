# GitHub Configuration & Operational Tools for Terraform CI/CD

This document consolidates the documentation for GitHub Actions Workflows and the CLI scripts used within this repository.

---

## GitHub Actions Workflows

### PRReview
- **PURPOSE**:
    - Determines Terraform execution paths and posts the results of `terraform plan` as a comment when a PR is created or updated.
- **BEHAVIOR**:
    - Identifies changed directories based on the diff between the base branch and the head branch.
    - Uses scripts under `.github/tfman/cli` for change detection.
    - Roots whose job fails before `terraform plan` runs (`fmt`, `init`, or `validate`) are listed as ❌ `Plan Failed` with `(Log file not found)` because no plan output exists; only failures inside `terraform plan` itself carry the captured error output, and plans that only change outputs are reported as changes rather than "No changes".
    - Finally, collects all results from artifacts and posts them in a comment. This flow is used to consolidate reports into a single post.
    - Stale plan comments are removed on every run, including when no results were produced, by scanning all comment pages. A missing plan artifact for an expected root is shown as ❌ `Plan Failed`. Pushes with zero changed Terraform roots also delete old plan comments without posting a new comment.
- **STATIC ANALYSIS** (steps appended to the `plan` job; per changed target, same scope as the plan):
    - **tflint** (gate) — installs the pinned `aws` plugin (cached under `~/.tflint.d/plugins`) and lints each changed root against the repo-root `.tflint.hcl`, passed via `--config` because tflint does not walk up to the repo root. Fails the job on findings at **warning severity or above** (hardcoded via `--minimum-failure-severity=warning`; edit that flag to change the threshold). Skipped when `.tflint.hcl` is absent. `.tflint.hcl`'s own `rule { enabled = false }` blocks already suppress `terraform_required_version` / `terraform_required_providers` (versions come from `.terraform-version`/tenv), so no CLI `--disable-rule` flags are needed.
    - **trivy** (informational) — scans each changed root using the repo-root `trivy.yaml`, writes a HIGH/CRITICAL summary to the Job Summary, and uploads the full JSON report as a `trivy-*` artifact. It **never fails the job** (`|| true`, no `--exit-code`) — advisory until the misconfiguration backlog is triaged. Skipped when `trivy.yaml` is absent.
    - Both run **after** the plan steps and even when `terraform plan` fails (`if: ${{ !cancelled() }}`), so a lint failure never suppresses the plan preview — the plan comment is still posted (post-plan runs `always()`).

### ManualOps
- **PURPOSE**:
    - Manually executes `terraform apply` for specific directories using workflow_dispatch. Multiple directories can be specified.
- **INPUT PARAMETERS**:
    - `targets`: Directory paths to apply (space-separated). Example: `app/dev app/prod`
    - `tf_targets`: *(Optional)* Terraform resource addresses to restrict the operation to (whitespace-separated). Passed as literal `-target=` flags to Terraform, preserving indexes such as `aws_instance.web[0]` and `aws_instance.web["blue"]` without shell filename expansion. Example: `aws_instance.example module.frontend`
    - `command`: The command to execute. The default is `apply`, but `plan` can be specified as an option.
- **CONDITIONS**:
    - **Execution User Restriction**: The executor (`github.actor`) must be listed in the `APPLIERS` repository variable. If not included, `terraform apply` is blocked. Re-runs also require the re-running user (`github.triggering_actor`) to be listed in `APPLIERS`.

### PRComment
- **PURPOSE**:
    - Triggers `terraform apply` or `terraform plan` when a PR comment starting with `$terraform` is posted.
- **MESSAGE COMMANDS**:
    - **`$terraform apply [targets...] [-target=<resource>...]`**
        - Executes `terraform apply`.
        - If directory targets are omitted, applies all detected changes.
        - Example: `$terraform apply`, `$terraform apply dev/frontend dev/backend`, `$terraform apply -target=aws_instance.web`, `$terraform apply -target aws_instance.web`, `$terraform apply dev/frontend -target=module.vpc -target=aws_subnet.main`
    - **`$terraform plan [targets...] [-target=<resource>...]`**
        - Executes `terraform plan`.
        - Example: `$terraform plan`, `$terraform plan dev/frontend`, `$terraform plan -target=aws_instance.web`, `$terraform plan -target aws_instance.web`
- **CONDITIONS**:
    - **Targets**: Directory targets must match Terraform root paths in `.tfdeps.json` (i.e., `dirs[].path`, relative to repo/workspace root). Leading `./` and trailing `/` are ignored, and duplicate targets are collapsed into a single job.
    - **-target**: Resource addresses follow standard Terraform address syntax (e.g., `aws_instance.example`, `module.frontend`, `aws_instance.web[0]`, `aws_instance.web["blue"]`). Both `-target=<resource>` and `-target <resource>` (space-separated) forms are supported. Multiple `-target` flags can be specified.
    - Apply requires both the comment author and the person who runs or re-runs the workflow (`github.triggering_actor`) to be listed in `APPLIERS`.
    - **Execution User Restriction**: Users not listed in `APPLIERS` can run `plan` but `apply` is blocked.
    - Command parsing and target resolution run with the tfman scripts from the repository's default branch. Terraform itself runs against the PR head commit SHA resolved at the start of the run (the same SHA the commit status is reported on), so a push to the PR branch during the run cannot change what gets planned or applied. Unauthorized `apply` requests are rejected before any cloud credentials are configured.
    - Cancelled runs report an `error` commit status and a comment with ❌ rows for roots that produced no artifact.

### DriftDetection
- **PURPOSE**:
    - Regularly executes `terraform plan` for all environments to detect discrepancies (Drift) between the code and the actual environment. It can also be executed manually.
- **BEHAVIOR**:
    - Executes `plan` for all directories defined in `.tfdeps.json`. If the graph contains no roots, the drift job is skipped.
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

`plan` runs with the same cloud identity as `apply` unless the OIDC role's trust policy / permissions are scoped; use a read-only role or a separate role for plan where possible.

#### Version Management
A `.terraform-version` file must exist in all working directories.

The repository root itself is never treated as a Terraform root; a root-level `.terraform-version` only pins the tool version. Nested roots are supported: a changed file is attributed to the deepest root that contains it. A local module that lives inside another root still triggers every root that consumes it.

#### Optional Environment Variables (`.env`)
When executing each job, if an `.env` file exists in `.github/env.d/<path>/`, its nonblank, noncomment lines are appended to `GITHUB_ENV`. Lines beginning with `#` after optional whitespace are comments; other lines are preserved as written. Empty files and files containing only comments or whitespace are valid and add no variables. If the file does not exist, the workflow logs a skip message and continues.

#### Dependency Definition (`.tfdeps.json`)
Root paths must be non-empty relative paths whose slash-separated segments match `[A-Za-z0-9][A-Za-z0-9._-]*`, with no empty segments or trailing slash.
`DriftDetection` and parts of the change detection logic depend on the `.tfdeps.json` file, which defines the directory structure and dependencies. Regenerate it whenever a Terraform root is added, removed, or moved, whenever a root starts or stops using a local module, or whenever a root's provider set changes (`.terraform.lock.hcl`). The workflows also select cloud credentials from the recorded providers, so a stale entry can leave a root without the credentials its new provider needs.

For update instructions, please refer to the **CLI Scripts** section below.

### Slack Integration
The following command is executed in the some channel. If you add a new workflow, you need to add the new workflow name to the command above and subscribe again.

```bash
/github subscribe org/repo workflows:{name: "DriftDetection,PRReview,ManualOps,PRComment"}
```

---

## GitHub Scripts (gh-scripts)

`.github/tfman/gh-scripts` contains scripts designed to be executed via `actions/github-script` within GitHub Actions workflows.

### Features
- **Actions Runtime Dependency**: Utilizes objects provided by the Actions runtime such as `github` (Octokit), `context`, and `core`.
- **Logic Separation**: Separates complex logic (e.g., PR comment formatting, artifact aggregation) from YAML files into JavaScript modules to keep workflows clean.

### Scripts
- `gh-scripts/post-comment.mjs`: Utility script for posting comments to Pull Requests. It handles formatting of `terraform plan` and `terraform apply` results, and aggregating reports from multiple matrix jobs. The full output is posted inline when it fits the comment size budget. Oversized output falls back to only the summary table with a link to the workflow run summary. The table itself is trimmed with an omission row only if it still exceeds the limit. Comments always stay within the size limit. Each run job's **Job Summary** (`$GITHUB_STEP_SUMMARY`) contains plan/apply output truncated at approximately 900 KB per root to respect GitHub's Job Summary limit. Complete `plan.txt` / `apply.txt` files are included in the run artifacts, which are retained for 1 day.

## GitHub Scripts CLI

A CLI tool designed to manage Terraform operations within a monorepo structure, located in `.github/tfman/cli`. It is implemented in Node.js and integrates seamlessly with GitHub Actions.

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
node .github/tfman/cli/index.mjs <command> [options]
```

### Commands

#### 1. `generate-deps`

Scans all directories containing `.terraform-version` (Terraform roots) and analyzes their module/provider usage.

**Usage:**
```bash
node .github/tfman/cli/index.mjs generate-deps [--output <path>] [--ignore-file <path>] [--root <path>]
```

- `--output`: Path to the output JSON file (Default: `.tfdeps.json` in workspace root).
- `--ignore-file`: Path to the ignore file (Default: `.tfdepsignore` in workspace root).
- `--root`: Path to the root directory to scan (Default: workspace root).

**Note:** `generate-deps` uses `terraform modules -json` (Terraform 1.10+). Only when Terraform reports that the `modules` subcommand does not exist, it falls back to the `.terraform/modules/modules.json` manifest written by `terraform init`, so run `terraform init` in those roots first. If module or provider extraction fails for any root, the command exits non-zero and does not write a partial `.tfdeps.json`.

**Side effects:** for every root that has no `.terraform/` directory, the command runs `terraform init -backend=false -input=false` in that root, which downloads providers and modules and may take a while on first run. Roots that already have a `.terraform/` directory are used as-is; if that directory is stale (e.g. a module `source` changed but `init` was not re-run), delete it or run `terraform init` in that root before regenerating.

#### 2. `detect-changes`

Compares two Git commits (base and head) to identify changed files and maps them to affected Terraform roots using the dependency graph.

**Usage:**
```bash
node .github/tfman/cli/index.mjs detect-changes --base <sha> --head <sha> [--deps-file <path>] [--output <path>]
```

- `--base`: Base commit SHA.
- `--head`: Head commit SHA.
- `--deps-file`: Path to the dependency graph file (Default: `.tfdeps.json` in the workspace root). If a path is given explicitly and is empty or cannot be read, the command exits with an error instead of falling back to the default.
- `--output`: If provided, writes `{ "include": [...] }` JSON to the given path. If omitted, prints the bare array (`[{ "path": ..., "providers": [...] }, ...]`) to stdout without the `include` wrapper, so callers that pipe stdout into a matrix must wrap it themselves (the workflows do this with `jq '{include: .}'`). Any failure exits non-zero with the error on stderr.

#### 3. `select-targets`

Validates a list of target directories against the known roots in `.tfdeps.json` and formats them for a GitHub Actions matrix.

**Usage:**
```bash
node .github/tfman/cli/index.mjs select-targets --targets "dir1 dir2" [--output <path>]
```

- `--targets`: Space-separated list of target directories.
- `--output`: If provided, writes `{ "include": [...] }` JSON to the given path. If omitted, prints the bare array (`[{ "path": ..., "providers": [...] }, ...]`) to stdout without the `include` wrapper, so callers that pipe stdout into a matrix must wrap it themselves (the workflows do this with `jq '{include: .}'`). Any failure exits non-zero with the error on stderr.

#### 4. `operate-command`

Parses a PR command comment (e.g., `$terraform apply app/dev`) and prepares the execution context.

**Usage:**
```bash
node .github/tfman/cli/index.mjs operate-command \
  --comment-body "<body>" \
  --base-sha <sha> \
  --head-sha <sha>
```

- `--roles`: Optional JSON array of roles. `apply` requires the string `"applier"`; invalid JSON or a non-array is treated as no roles. Omitting this option preserves behavior without a role gate. `plan` is unaffected.
- `--actor`: Optional login used in the permission-denied message.
- `--github-output`: Appends the JSON fields (`command`, `done` as `true`/`false`, `message`, `tf_targets_json`, and `matrix` as `{"include":[…]}` or empty string) as step outputs to the given file.

**Output contract:** the command always prints a single JSON object to stdout and exits 0, even when the comment is invalid or no targets match — the workflow reads `done` and `message` to decide whether to post a reply instead of relying on the exit code:

```json
{ "command": "plan" | "apply" | "help" | "error", "targetDirs": [...], "tfTargets": [...], "message": "...", "done": true | false }
```

- `done: true` means there is nothing to execute (help, parse error, denied apply, or no matching targets) and `message` should be posted to the PR as-is. The workflow resolves roles from `APPLIERS` and passes them via `--roles`/`--actor`. When `--roles` is given, the CLI rejects `apply` for non-appliers with `done: true` before selecting targets. The `run` job still re-checks roles before `terraform apply` as defense in depth.
- Only the **first line** of the comment body is parsed; anything after the first newline is ignored.
- A non-zero exit happens only for missing required arguments or an internal failure.

#### 5. `write-result`

Writes artifact metadata, a Job Summary, and artifact naming outputs for a Terraform result.

```bash
cd <terraform-root>
node <path-to>/.github/tfman/cli/index.mjs write-result \
  --path <terraform-root> --command plan --outcome success
```

- `--path`: Required Terraform root relative path.
- `--command`: Required `plan` or `apply`; selects `plan.txt` or `apply.txt` in the working directory.
- `--outcome`: Required string; only `success` is successful, and all other values become `failure`.

The command reads the current working directory and the `GITHUB_STEP_SUMMARY` / `GITHUB_OUTPUT` environment variables directly. If the log exists and `GITHUB_STEP_SUMMARY` is non-empty, it appends a Plan/Apply heading and fenced log content capped at 900,000 bytes, with embedded triple backticks replaced by `~~~`. When `GITHUB_OUTPUT` is non-empty, it appends `clean_path` and `artifact_name`.

Always writes `info.json` in the working directory with `path` and normalized `outcome`. `clean_path` replaces slashes with hyphens and appends the first eight lowercase SHA-256 hex characters of the exact path. `artifact_name` is `<command>-<clean_path>`, preserving artifact download patterns.

### Configuration Files

#### `.tfdeps.json`
Generated by `generate-deps`. Maps each Terraform root to its local module dependencies and provider requirements.

Only modules that resolve to a directory inside this repository are recorded as dependencies: relative `source` paths (`./…`, `../…`) and `git::` / `github.com/…` sources whose host, owner and repository name exactly match the `origin` remote and that are not pinned with `?ref=`. Modules from other repositories, registry modules, and ref-pinned sources are not tracked, because changes in this working tree do not affect them.

#### `.tfdepsignore`
Dependency scanning ignore rules.

- Format: whitespace-separated patterns. **Recommended:** one pattern per line.
- Blank lines are ignored.
- Lines starting with `#` are treated as comments.
- Patterns are **not** globs (`*` and `?` have no special meaning). A pattern matches a directory when it equals the directory's name at any depth (`node_modules` skips every `node_modules/`), or when it equals or is a path prefix of the directory's path relative to the workspace root (`envs/legacy` skips `envs/legacy/` and everything under it, but not `envs/legacy-v2/`).
- Matched directories are skipped entirely, including any Terraform roots inside them.

Example:

```text
.git
.github
.terraform
node_modules
```
