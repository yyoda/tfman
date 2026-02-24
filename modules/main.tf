variable "triggers" {
  type = map(string)
}

resource "null_resource" "main" {
  triggers = var.triggers
}

output "triggers" {
  value = var.triggers
}
