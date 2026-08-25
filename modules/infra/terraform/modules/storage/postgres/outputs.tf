output "postgres_host" {
  description = "Hostname (container name, resolvable on network_name) the app modules build DATABASE_URL from."
  value       = docker_container.postgres.name
}

output "postgres_user" {
  value = var.postgres_user
}
