output "network_name" {
  description = "Docker network app containers must join to reach postgres/redis by hostname."
  value       = docker_network.apps.name
}
