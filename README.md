# God-Tier Terraform CI/CD — Multi-Cloud · Multi-Account · Monorepo

A battle-tested reference implementation for managing Terraform at scale with GitHub Actions. Stop fighting your CI/CD. Start shipping infrastructure confidently.

---

## The Problem: Terraform at Scale is a Nightmare

When you start with Terraform, a single state file and a `terraform apply` command is fine. But as your organization grows — more environments, more cloud accounts, more teams — that simple workflow falls apart fast.

| Pain Point | What Actually Happens |
|---|---|
| **Which environments did I break?** | A module change touches 6 roots. You manually run plan on each. You miss one. It breaks in production. |
| **The plan was green yesterday...** | Someone applied a manual change directly. The code and reality are out of sync. You find out during the next outage. |
| **Who approved this apply?** | Anyone with repo access can apply. No audit trail. No guardrails. |
| **Multi-account credentials are a mess** | You maintain a sprawling secrets config. Rotating credentials is an all-day task. |
| **The plan output is buried in logs** | Reviewers can't tell what's actually changing. They rubber-stamp PRs. Surprises happen. |
| **CI takes 20 minutes for a 2-line change** | All 30 environments plan sequentially. The queue backs up. Everyone waits. |

**This repository solves all of these.**

---

## What You Get

### Smart Change Detection — Plan Only What Changed

The core innovation: a dependency graph (`.tfdeps.json`) maps every Terraform root to the modules it uses. When a PR modifies `modules/networking`, the pipeline automatically identifies and plans only the roots that consume that module — not all 30 environments.

```
PR changes: modules/networking/main.tf
    ↓
Dependency graph lookup
    ↓
Affected roots: environments/prod-us, environments/prod-eu, environments/staging
    ↓
terraform plan × 3 (in parallel)    ← Only these. Nothing else.
```

No more guessing. No more over-running. No more missed impacts.

### Parallel Execution — Finish in Minutes, Not Hours

Every affected environment runs as an independent GitHub Actions matrix job. Three roots run in parallel and finish together. Thirty roots? Still fast. The pipeline scales horizontally with your infrastructure.

Note: GitHub Actions matrix has practical limits (e.g., up to 256 jobs per workflow run). Very large monorepos may need workflow sharding or hierarchy.

### Drift Detection — Catch Reality Diverging from Code

Infrastructure drift is silent and deadly. A manual hotfix, a cloud console click, an auto-scaling event — these all diverge your actual state from your Terraform code. Left unchecked, the next `terraform apply` produces surprises.

The scheduled `DriftDetection` workflow runs `terraform plan` across **all** environments on a regular cadence. If any plan shows a diff, the workflow fails. Slack notifications are optional via GitHub notifications/Slack subscription (see the Slack integration section).

### PR-First Workflow — Review Infrastructure Like Code

`terraform plan` output lands directly in your PR as a formatted comment. Every reviewer sees exactly what changes before they approve. Old plan comments are replaced automatically — no noise, no confusion about which result is current.

```
environments/prod-us  │ +2 to add, ~1 to change, 0 to destroy
environments/staging  │ +2 to add, ~1 to change, 0 to destroy
```

Collapsible details. Change counts at a glance. Large outputs split across multiple comments automatically. Infrastructure review becomes as natural as code review.

### ChatOps — Apply from the PR Comment Thread

No need to leave the PR to trigger an apply. Comment directly:

```
$terraform apply
$terraform apply environments/prod-us environments/prod-eu
$terraform plan environments/staging
$terraform help
```

The pipeline parses the command, validates the targets, checks permissions, executes the operation, and posts the result — all in the same thread. Full audit trail in the PR history.

Note: targets must match Terraform root paths in `.tfdeps.json` (i.e., `dirs[].path`, relative to the repository root).

### Role-Based Access Control — Not Everyone Should Apply

Two roles. Zero ambiguity.

| Role | Permissions | Assignment |
|---|---|---|
| `planner` | `terraform plan` only | Default for all users |
| `applier` | `terraform plan` + `terraform apply` | Listed in `APPLIERS` variable |

Update `APPLIERS` in GitHub repository settings. No code changes required. Add or revoke production access in seconds.

Note: `APPLIERS` is a repo-wide allowlist (coarse-grained). If you need per-environment RBAC, you’ll need additional policy/design.

### OIDC Authentication — No Long-Lived Credentials

Every environment authenticates to its cloud provider using OIDC. No static AWS access keys. No service account JSON files rotting in secrets. Each environment's `.env.ci` specifies exactly which IAM role to assume, which subscription to target, which project to use.

Multi-account AWS? Each environment assumes its own role. Multi-cloud? Each environment configures its own provider. The pipeline detects the required provider from the dependency graph and sets up authentication automatically.

### Version Pinning Per Environment — No Surprise Upgrades

A `.terraform-version` file in each environment root pins the exact Terraform version. `environments/legacy` can run 1.5.7 while `environments/greenfield` runs 1.14.5 — simultaneously, in the same pipeline. Upgrade on your own schedule.

---

## Architecture Overview

```
GitHub Event (PR open/update, comment, schedule, manual dispatch)
         │
         ▼
┌─────────────────────────────────┐
│  detect-changes / select-targets │  ← CLI: git diff × .tfdeps.json
└─────────────────────────────────┘
         │  affected roots list
         ▼
┌─────────────────────────────────┐
│  GitHub Actions Matrix          │  ← One job per root (parallel)
│  ┌──────────┐  ┌──────────┐    │
│  │  root-A  │  │  root-B  │    │
│  │  plan/   │  │  plan/   │    │
│  │  apply   │  │  apply   │    │
│  └──────────┘  └──────────┘    │
└─────────────────────────────────┘
         │  artifacts (per job)
         ▼
┌─────────────────────────────────┐
│  Aggregate & Post Results        │  ← Single PR comment with all results
└─────────────────────────────────┘
```

### Workflows at a Glance

| Workflow | Trigger | What It Does |
|---|---|---|
| **PRReview** | PR created / updated | Detects changed roots → plans in parallel → posts comment |
| **PRComment** | PR comment `$terraform ...` | Parses command → validates auth → runs plan/apply → posts result |
| **ManualOps** | `workflow_dispatch` | Runs plan/apply for specified targets with auth check |
| **DriftDetection** | Schedule (+ manual) | Plans all roots → fails on drift (Slack optional) |

---

## Directory Structure

```
.
├── environments/          # Terraform root modules (one per env/account)
│   ├── test1/
│   │   ├── main.tf
│   │   ├── .terraform-version   ← Required: pins TF version
│   │   └── .env.ci              ← Optional*: cloud auth config
│   └── test2/
├── modules/               # Shared Terraform modules
├── .github/
│   ├── workflows/         # GitHub Actions workflow definitions
│   └── scripts/
│       ├── cli/           # Node.js CLI (generate-deps, detect-changes, …)
│       ├── gh-scripts/    # Actions runtime scripts (comment posting)
│       └── lib/           # Shared logic
├── .tfdeps.json           # Generated dependency graph (commit this)
└── .tfdepsignore          # Ignore patterns excluded from dep scanning
```

\* `.env.ci` is optional as a concept, but the current workflows may fail if the file is missing. For now, create an empty `.env.ci` if you don't need any variables (a follow-up change can make workflows truly optional).

---

## State & Backend (Important)

- This repository may include sample `terraform.tfstate` / `terraform.tfstate.backup` files for demonstration.
- In real projects, do **not** commit state files. Configure a **remote backend** (e.g., S3 + DynamoDB, Terraform Cloud, AzureRM backend) and keep state out of git.
- The included `.gitignore` already ignores `terraform.tfstate.*`.

`.tfdepsignore` format:

- Whitespace-separated patterns (recommended: one pattern per line)
- Blank lines are ignored
- Lines starting with `#` are comments

---

## Adopting This in Your Repository

### 1. Prerequisites

- Node.js 18+ (20+ recommended)
- Terraform CLI
- GitHub repository with Actions enabled

### 2. Copy the `.github/` directory

Copy the entire `.github/` directory from this repository into your own. This includes all workflow files, scripts, and actions.

### 3. Create your Terraform environments

Create a directory for each Terraform root under `environments/`. Each directory requires:

- Terraform configuration files (e.g., `main.tf`)
- `.terraform-version` **(required)** — pins the Terraform version; environments without this file are ignored by the pipeline
- `.env.ci` *(optional\*)* — loaded automatically before each CI job; used to configure per-environment cloud credentials via OIDC

\* Note: in the current workflows, the “Load .env.ci” step may fail if `.env.ci` is missing (because it uses `test -f .env.ci && ...`). Until workflows are adjusted, create an empty `.env.ci` even if you don't need cloud auth variables.

Example `.env.ci` for AWS:

```
AWS_ROLE_ARN=arn:aws:iam::<account-id>:role/<role-name>
AWS_REGION=<region>
```

### 4. Configure cloud provider authentication

Use OIDC-based authentication (no long-lived credentials):

- **AWS**: Create an IAM Role with a GitHub OIDC trust policy and reference it in `.env.ci`
- **Azure / GCP**: Configure the corresponding OIDC credentials in `.env.ci`

### 5. Generate the dependency graph

Run once to scan all Terraform roots and build the dependency graph:

```bash
node .github/scripts/cli/index.mjs generate-deps
```

Commit the generated `.tfdeps.json`. Re-run whenever you add or remove an environment directory.

> [!TIP]
> For reproducible provider selection (and better CI caching), commit each root's `.terraform.lock.hcl` after running `terraform init`.

This file drives two critical behaviors:
- **Change detection**: determines which roots are affected by a PR's changes
- **Drift detection**: provides the list of all roots to plan on a schedule

### 6. Configure operator permissions

Go to **Settings > Secrets and variables > Actions > Variables** and create `APPLIERS`:

```json
["your-github-username"]
```

Users not listed default to `planner` (plan only). If `APPLIERS` is not set, apply operations are blocked for all users.

> [!IMPORTANT]
> The `applier` role is required for `ManualOps` and `PRComment` workflows to execute `apply`.

### 7. (Recommended) Require up-to-date branches before merging

A PR plan becomes stale the moment new commits land on the base branch. Merging a stale plan can produce unexpected changes.

Prevent this by enabling **"Require branches to be up to date before merging"**:

1. Go to **Settings > Rules > Rulesets** (or **Settings > Branches** for classic protection)
2. Create or edit the ruleset targeting your main branch
3. Enable **"Require branches to be up to date before merging"**
4. Save

### 8. (Optional) Slack integration (via GitHub → Slack subscription)

```
/github subscribe <org>/<repo> workflows:{name: "DriftDetection,PRReview,ManualOps,PRComment"}
```

---

## CLI Reference

The CLI lives in `.github/scripts/cli/` and is used both by the workflows and locally.

```bash
node .github/scripts/cli/index.mjs <command> [options]
```

| Command | Description |
|---|---|
| `generate-deps` | Scan all Terraform roots and generate `.tfdeps.json` |
| `detect-changes --base <sha> --head <sha>` | Map a git diff to affected roots |
| `select-targets --targets "dir1 dir2"` | Validate and format targets for the matrix |
| `operate-command --comment-body "..." --base-sha ... --head-sha ...` | Parse a PR comment command |

For full option details, see [`.github/workflows/README.md`](.github/workflows/README.md).

---

## Why This Over Alternatives?

| Feature | This Repo | Atlantis | HCP Terraform (Terraform Cloud) | OpenTaco (Digger) | Custom Scripts |
|---|---|---|---|---|---|
| Monorepo change detection | ✅ Dependency-aware | ⚠️ Directory-based by default (module-aware requires config) | ⚠️ Workspace working directory + trigger config required for monorepos | ⚠️ Config-driven (patterns/layers); not an auto dependency graph | ⚠️ Possible, but you build/maintain it |
| Parallel execution | ✅ Matrix per root | ⚠️ Parallel plan/apply is configurable | ✅ (org-level concurrency; 1 run/workspace) | ⚠️ Layer-based parallelism (requires config) | ⚠️ Possible, but you build/maintain it |
| Drift detection | ✅ Scheduled (Slack optional\*) | ⚠️ Not a built-in feature; requires surrounding automation | ✅ (typically paid tier) | ⚠️ Available, but typically requires additional components/integration | ⚠️ Possible, but you build/maintain it |
| PR comment ChatOps | ✅ | ✅ | ⚠️ PR-based workflows exist, but not PR-comment ChatOps | ✅ | ⚠️ Possible, but you build/maintain it |
| Zero new infrastructure | ✅ GitHub Actions only | ❌ Needs server | ❌ Needs SaaS | ⚠️ Often adds components beyond GitHub Actions | ✅ |
| Per-env version pinning | ✅ `.terraform-version` | ✅ | ✅ (workspace setting) | ✅ | ✅ |
| RBAC without extra tooling | ⚠️ `APPLIERS` allowlist (repo-wide) | ✅/⚠️ (server-side config) | ✅ (workspace-level RBAC) | ✅ (policy-based, e.g., OPA) | ⚠️ Usually needs VCS/CI policy + custom logic |

† `⚠️` means "achievable, but requires configuration / extra components / additional automation" — not "impossible".

\* Slack is not implemented inside the workflows (no webhook/bot). Use GitHub → Slack integration to subscribe to workflow notifications.

This repository runs entirely on GitHub Actions — no additional servers, no SaaS subscriptions, no new infrastructure to manage.

---

*For CI/CD pipeline details and CLI documentation, see [`.github/workflows/README.md`](.github/workflows/README.md).*
