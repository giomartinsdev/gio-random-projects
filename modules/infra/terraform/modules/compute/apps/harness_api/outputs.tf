output "container_name" {
  description = "Name of the harness-api container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.harness_api.name
}

output "external_port" {
  description = "Host port harness-api publishes on, matched by locals.tf's service entry."
  value       = var.external_port
}