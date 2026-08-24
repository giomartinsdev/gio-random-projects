variable "network_name" {
  description = "Docker network (from module.compute_data) to join -- bookclub-api reaches this container by name on the same network."
  type        = string
}

variable "root_user" {
  description = "MinIO root username -- not treated as sensitive (a username, not a secret), same reasoning as var.registry_user."
  type        = string
  default     = "bookclub-minio-admin"
}

variable "root_password" {
  description = "MinIO root password."
  type        = string
  sensitive   = true
}
