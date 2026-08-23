output "network_name" {
  description = "Docker network app containers must join to reach postgres/redis by hostname."
  value       = docker_network.apps.name
}

output "postgres_host" {
  description = "Hostname (container name, resolvable on network_name) the app module builds DATABASE_URL from."
  value       = docker_container.postgres.name
}

output "postgres_user" {
  value = var.postgres_user
}

output "redis_host" {
  description = "Hostname (container name, resolvable on network_name) the app module builds REDIS_ADDR from."
  value       = docker_container.redis.name
}
