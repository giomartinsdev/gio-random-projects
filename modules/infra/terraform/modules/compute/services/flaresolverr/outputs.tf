output "url" {
  description = "In-network FlareSolverr endpoint (the scrapers' challenge workaround)."
  value       = "http://${docker_container.flaresolverr.name}:8191"
}