output "redis_host" {
  description = "Hostname (container name, resolvable on network_name) the app modules build REDIS_ADDR from."
  value       = docker_container.redis.name
}
