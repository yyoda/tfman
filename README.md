# The "God-Tier" Terraform CI/CD I've Always Wanted (Multi-Cloud, Multi-Account, Monorepo)

This repository serves as a reference implementation for managing multi-cloud, multi-account, and monorepo infrastructure using Terraform and GitHub Actions.

## 📁 Directory Structure

The project follows a standard structure:

- **`environments/`**: Contains environment-specific Terraform configurations (Root Modules) such as `test1`, `test2`. Each directory corresponds to a separate Terraform State.
- **`modules/`**: Contains reusable Terraform modules shared across environments.
- **`.github/`**: Contains GitHub Actions workflows, scripts, and related documentation.

## 🚀 CI/CD & Operations

For details on the CI/CD pipeline (Plan, Apply, Drift Detection) and operational scripts, please refer to the documentation below:

- [**CI/CD & Operational Tools Documentation**](.github/workflows/README.md)

## 📦 Using This in Your Project

Follow these steps to adopt this CI/CD setup in your own repository.

### 1. Prerequisites

- Node.js 18+ (20+ recommended)
- Terraform CLI
- GitHub repository with Actions enabled

### 2. Copy the `.github/` directory

Copy the entire `.github/` directory from this repository into your own repository. This includes all workflow files, scripts, and actions.

### 3. Create your Terraform environments

Create a directory for each Terraform root under `environments/`. Each directory requires:

- Terraform configuration files (e.g., `main.tf`)
- `.terraform-version` **(required)** — The CI/CD workflows use this file to pin the exact Terraform version for each environment. Without it, the environment will not be recognized as a Terraform root and will be excluded from all CI/CD operations.
- `.env.ci` *(optional)* — A file for setting environment-specific variables that are automatically loaded before each CI job runs. This is primarily used to configure cloud provider authentication via OIDC (e.g., which IAM role to assume on AWS, which subscription to target on Azure). Since authentication requirements differ per environment, each directory has its own `.env.ci`. Example for AWS:

```
AWS_ROLE_ARN=arn:aws:iam::<account-id>:role/<role-name>
AWS_REGION=<region>
```

### 4. Configure cloud provider authentication

Set up authentication from GitHub Actions to your cloud provider. The recommended approach is OIDC-based authentication (no long-lived credentials):

- **AWS**: Create an IAM Role with a GitHub OIDC trust policy and reference it in `.env.ci`
- **Azure / GCP**: Configure the corresponding OIDC credentials in `.env.ci`

### 5. Generate the dependency graph

The CI/CD workflows rely on `.tfdeps.json` to know which Terraform roots exist and how they relate to shared modules. This file drives two critical behaviors:

- **Change detection**: When a PR is opened, the pipeline looks up `.tfdeps.json` to determine which environments are affected by the changed files and runs `terraform plan` only for those.
- **Drift detection**: The scheduled drift detection workflow iterates over all roots listed in `.tfdeps.json`.

Without this file, the workflows cannot determine what to run and will have no targets to operate on.

Run the following command to scan all Terraform roots and generate `.tfdeps.json`:

```bash
node .github/scripts/cli/index.mjs generate-deps
```

Commit the generated `.tfdeps.json` to your repository. Re-run this command whenever you add or remove a Terraform environment directory.

### 6. Configure operator permissions

Create `.github/workflows/.permission.json` to define which GitHub users are permitted to run `terraform apply`:

```json
{
  "applier": [
    "your-github-username"
  ]
}
```

This file is excluded from Git by default (via `.github/workflows/.gitignore`). Users not listed in this file default to the `planner` role and can only trigger `terraform plan`. If the file does not exist, all users are treated as `planner` and apply operations are disabled.

> [!IMPORTANT]
> The `applier` role is required for `ManualOps` and `PRComment` workflows to execute `apply`. Without any `applier` entries, those workflows will always be skipped.

### 7. (Recommended) Enforce up-to-date branches before merging

When a PR becomes outdated (i.e., new commits are merged into the base branch after the PR's `terraform plan` ran), the plan results shown on that PR are no longer accurate. Merging based on a stale plan can lead to unexpected infrastructure changes.

To prevent this, enable **"Require branches to be up to date before merging"** in your repository settings. This forces contributors to rebase or merge the latest base branch before they can merge, ensuring the `PRReview` workflow always runs against the current state.

**Setup:**

1. Go to **Settings > Rules > Rulesets** (or **Settings > Branches** for classic branch protection)
2. Create or edit the ruleset targeting your main branch (e.g., `main`)
3. Under **Branch rules**, enable **"Require branches to be up to date before merging"**
4. Save the ruleset

### 8. (Optional) Slack integration

To receive workflow notifications in Slack, use the GitHub Slack app and subscribe to the workflows:

```
/github subscribe <org>/<repo> workflows:{name: "DriftDetection,PRReview,ManualOps,PRComment"}
```
