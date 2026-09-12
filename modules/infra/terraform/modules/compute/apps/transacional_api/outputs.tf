output "container_name" {
  description = "Name of the transacional-api container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.transacional_api.name
}

output "external_port" {
  description = "Host port transacional-api publishes on, matched by locals.tf's service entry."
  value       = var.external_port
}
