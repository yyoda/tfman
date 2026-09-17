resource "random_id" "main" {
  byte_length = 8
}

module "main" {
  source = "../../modules"
  triggers = {
    name = "test2"
    id   = random_id.main.hex
  }
}

output "result" {
  description = "Result of the main module"
  value       = module.main
}



resource "null_resource"   "broken" {
    triggers   = { name="broken" }
}
