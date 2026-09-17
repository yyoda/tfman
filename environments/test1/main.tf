resource "random_id" "main" {
  byte_length = 8
}

module "main" {
  source = "../../modules"
  triggers = {
    name = "test1"
    id   = random_id.main.hex
  }
}

output "result" {
  description = "Result of the main module"
  value       = module.main
}

# --- CI verification (scratch, do not merge) ---

# tflint gate: camelCase violates terraform_naming_convention (warning)
variable "badName" {
  type        = string
  description = "Intentional naming violation for tflint gate check"
  default     = "x"
}

# Large plan: push the PR comment past GitHub's size limit
resource "random_id" "bulk" {
  count       = 300
  byte_length = 8
}

# Import block: exercise "N to import" parsing in the plan summary
import {
  to = random_id.imported
  id = "p-9hUgAAAAA"
}

resource "random_id" "imported" {
  byte_length = 8
}
