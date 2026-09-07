output "container_name" {
  description = "Name of the cch-api container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.cch_api.name
}

output "external_port" {
  description = "Host port cch-api binds on, matched by locals.tf's service entry."
  value       = var.external_port
}