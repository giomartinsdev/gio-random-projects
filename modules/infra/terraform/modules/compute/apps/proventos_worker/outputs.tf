output "container_name" {
  description = "Name of the proventos-worker container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.proventos_worker.name
}
