output "container_name" {
  description = "Name of the tela container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.tela.name
}

output "external_port" {
  description = "Host port tela is published on, matched by locals.tf's ingress rule."
  value       = var.external_port
}
