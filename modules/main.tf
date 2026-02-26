variable "triggers" {
  type = map(string)
}

resource "null_resource" "default" {
  triggers = var.triggers
}
