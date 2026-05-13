variable "triggers" {
  type = map(string)
}

resource "null_resource" "debug" {
  triggers = var.triggers
}
