output "container_name" {
  description = "Name of the apostas-resultado-worker container -- used by go-ci-cd.yml's -replace= target."
  value       = docker_container.apostas_resultado_worker.name
}
