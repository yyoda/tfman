variable "triggers" {
  type = map(string)
}

resource "null_resource" "test16" {
  triggers = var.triggers
}
