output "container_name" {
  description = "Name of the tela-api container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.tela_api.name
}

output "mediamtx_container_name" {
  description = "Name of the MediaMTX container carrying tela's screen-share media."
  value       = docker_container.mediamtx.name
}

output "external_port" {
  description = "Host port tela-api is published on, matched by locals.tf's service entry."
  value       = var.external_port
}
