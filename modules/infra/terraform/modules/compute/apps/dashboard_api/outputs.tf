output "container_name" {
  description = "Name of the dashboard-api container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.dashboard_api.name
}

output "external_port" {
  description = "Host port dashboard-api publishes on, matched by locals.tf's service entry."
  value       = var.external_port
}
