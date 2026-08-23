output "domain_api_container_name" {
  value = docker_container.domain_api.name
}

output "domain_worker_container_name" {
  value = docker_container.domain_worker.name
}
