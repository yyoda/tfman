# TFLint configuration — deterministic Terraform linting.
# Runs in CI (.github/workflows/pr-review.yml) per changed target; fails the job
# on findings at warning severity or above. This file's presence is the CI
# on-switch — the tflint steps skip when it is absent.

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.44.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

# Naming: snake_case everywhere.
rule "terraform_naming_convention" {
  enabled = true
  format  = "snake_case"
}

# Variables/outputs: explicit type + description required.
rule "terraform_typed_variables" {
  enabled = true
}

rule "terraform_documented_variables" {
  enabled = true
}

rule "terraform_documented_outputs" {
  enabled = true
}

# Version pinning comes from .terraform-version (tenv), NOT required_providers.
# Disable the rules that would fight that policy.
rule "terraform_required_providers" {
  enabled = false
}

rule "terraform_required_version" {
  enabled = false
}
