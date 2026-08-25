variable "postgres_password" {
  description = "Password for the postgres user. Generate: openssl rand -base64 24"
  type        = string
  sensitive   = true
}

variable "postgres_user" {
  description = "Postgres user/database name."
  type        = string
  default     = "domain"
}

variable "postgres_image" {
  description = "Postgres image tag."
  type        = string
  default     = "postgres:17-alpine"
}

variable "network_name" {
  description = "Name of the docker network (from network/docker_apps)."
  type        = string
  default     = "apps"
}
