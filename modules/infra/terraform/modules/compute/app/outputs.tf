output "api_container_name" {
  value = docker_container.api.name
}

output "worker_container_name" {
  value = docker_container.worker.name
}
