output "container_name" {
  description = "Name of the contas-api container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.contas_api.name
}

output "external_port" {
  description = "Host port contas-api publishes on, matched by locals.tf's service entry."
  value       = var.external_port
}
