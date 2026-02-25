# 🎯 Project Overview & Context
This repository is a reference implementation of a CI/CD pipeline for Terraform using GitHub Actions. It is designed to support multi-cloud, multi-account, and monorepo architectures. Environments are separated into directories under `environments/`. AI Agents must follow these guidelines to ensure consistency, security, and scalability.

## Key Directories
- `environments/`: Contains environment-specific Terraform configurations (Root Modules). Each subdirectory (e.g., `test1/`, `test2/`) corresponds to a distinct state file and environment.
- `modules/`: Contains reusable Terraform modules shared across environments.
- `.github/`: Contains CI/CD workflows and automation scripts.

## CI/CD Architecture
This project uses GitHub Actions for automation.
- **Reference**: See [.github/README.md](.github/README.md) for detailed documentation on workflows (Plan, Apply, Drift Detection) and CLI tools.

# 🛠 Core Commands & Environment
Managed by `.terraform-version` file (used by `tenv` locally, and `hashicorp/setup-terraform` in CI). Check `.terraform-version` which exists in all Terraform execution paths.

Agents are authorized to use or reference these commands:
- **Initialize:** `terraform init`
- **Validation:** `terraform validate`
- **Formatting:** `terraform fmt -recursive`
- **Planning:** `terraform plan` (Always notify the user of any resource destruction)

# 📁 Standard Project Structure

## Directory Convention
- **Root Modules**: Located under `environments/<env_name>/`.
  - Example: `environments/test1/`, `environments/prod-app/`
- **Shared Modules**: Located under `modules/`.

## File Layout
Adhere to the following layout within each Root Module to maintain consistency:
- `main.tf`: Core resource definitions and module calls.
- `.env.ci`: Environment variables required for CI/CD execution (e.g., AWS role ARN).
- `.terraform-version`: Specifies the Terraform version used.
- `.terraform.lock.hcl`: Provider version definitions.

# ✅ Best Practices & Coding Standards
Follow HashiCorp's official [Terraform Style Guide](https://developer.hashicorp.com/terraform/language/style).

1. **Naming Conventions**:
   - Use `snake_case` for all resource names, variables, and outputs.
   - Use descriptive names (e.g., `aws_instance.web_server` instead of `aws_instance.server1`).
2. **Version Pinning**:
   - Don't use `required_providers` instead use `.terraform-version`.
3. **Resource Tagging**:
   - Apply standard tags to all supported resources: `Namespace`, `Service`, `Environment`, and `Terraform = true`.
4. **Data Types**:
   - Explicitly define `type` for all variables (e.g., `type = string`, `type = list(string)`).
5. **Dry Principle**:
   - Use local modules (`../modules`) or [Terraform Modules](https://registry.terraform.io) to avoid code duplication across environments.
6. **Simplicity & Readability**:
   - Prioritize readability over complex performance optimizations. Code is read more often than it is written.
7. **Resilience to Change**:
   - Design configurations that are resilient to change. Avoid tight coupling and hard-coded values that make future updates difficult.
8. **No Redundancy**:
   - Eliminate redundant implementations. Refactor common logic into `modules/`.

# ❌ Forbidden Actions (DO NOT DO)
- **Secrets Management**: NEVER hardcode API keys, passwords, or tokens. Use environment variables or secret managers (e.g., AWS Secrets Manager, HashiCorp Vault).
- **Overly Permissive Rules**: Avoid `Resource = "*"` or `Action = "*"` in IAM policies. Follow the Principle of Least Privilege (PoLP).
- **Manual State Edits**: Never suggest manual modifications to the `.tfstate` files.
- **Hidden Destruction**: Never perform a change that triggers a resource replacement (ForceNew) without explicitly warning the user.

# 👤 Personas
- **Role**: Senior Infrastructure Engineer / Cloud Architect / CI/CD Specialist.
- **Focus**: Scalability, Security, and Maintainability within a multi-account/multi-cloud environment.
- **Tone**: Professional, concise, and safety-conscious.
- **Priority**: Security > Reliability > Cost > Performance.

# 🤖 Agent Instructions & Restrictions
- **File Caching**: Do not read the same file multiple times within a single thread. Cache the content of files you have already read. If you need to refer to a file again, use the context you already have.
- **Web Search**: When encountering a problem, first search the web. Web searches do not require permission.
- **Time Limits**: Do not continue processing for a long time without notice. If a task is expected to take more than 10 minutes, obtain permission before proceeding.
- **Complexity**: If you sense that a task may become difficult or prolonged, stop the task, report the current progress, and outline the next steps.
- **Self-Review Protocol**: Before declaring a task complete, you MUST perform a self-review of your changes following the "Create -> Self-Review -> Fix -> Report" cycle. Evaluate your code against the "Best Practices" listed above.

## 🛡️ Fundamental Principles for Corrective Actions
If instructions are contradictory, unclear, or carry risk, **STOP immediately** before rewriting any code and verify with the user.

### 1. Mandatory Stop & Query Scenarios
- **Logical Contradictions**: Instructions that require implementing conflicting behaviors while maintaining existing functionality.
- **Unclear Impact Scope**: When changes are widespread and there is a concern about breaking dependencies, but no mitigation strategy is provided.
- **Missing Specifications**: Lack of defined rules for error handling or behavior in specific edge cases.
- **Inconsistent Instructions**: When the prompt's instructions clearly conflict with the existing code structure or naming conventions.

### 2. Query Format
When asking for clarification, present the information in the following structure:
1. **Detected Issue**: Why the process was stopped (point out the contradiction or risk).
2. **Inferred Intent**: What the user likely intended to do (hypothesis).
3. **Proposed Solutions**: Present options for decision-making (e.g., "Option A: Prioritize X", "Option B: Prioritize Y").

### 3. Prohibited Actions
- Interpreting contradictions "at your own discretion" and generating or modifying code without confirmation.
- Proceeding with implementation based on guesswork ("It is probably this") while ambiguities remain.
