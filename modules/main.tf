variable "triggers" {
  type = map(string)
}

resource "null_resource" "testtttt" {
  triggers = var.triggers
}
