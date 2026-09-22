output "container_name" {
  description = "Name of the clubs-ingest container -- used by python-ci-cd.yml's -replace= target."
  value       = docker_container.clubs_ingest.name
}
