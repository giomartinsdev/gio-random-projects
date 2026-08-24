output "endpoint" {
  description = "Internal host:port bookclub-api's MinIO client connects to."
  value       = "${docker_container.minio.name}:9000"
}

output "root_user" {
  value = var.root_user
}
