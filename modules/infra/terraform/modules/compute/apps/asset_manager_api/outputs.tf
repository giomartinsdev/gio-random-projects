output "container_name" {
  description = "Name of the asset-manager-api container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.asset_manager_api.name
}

output "external_port" {
  description = "Host port asset-manager-api publishes on, matched by locals.tf's service entry."
  value       = var.external_port
}
