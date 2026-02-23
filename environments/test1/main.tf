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
  value = module.main
}

output "test" {
  value = "test"
}
