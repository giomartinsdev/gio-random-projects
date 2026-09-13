output "container_name" {
  description = "Name of the leads-api container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.leads_api.name
}

output "external_port" {
  description = "Host port leads-api publishes on, matched by locals.tf's service entry."
  value       = var.external_port
}
