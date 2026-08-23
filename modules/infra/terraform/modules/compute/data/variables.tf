variable "postgres_password" {
  description = "Password for the domain Postgres user. Generate: openssl rand -base64 24"
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

variable "redis_image" {
  description = "Redis image tag."
  type        = string
  default     = "redis:7-alpine"
}

variable "network_name" {
  description = "Name of the docker network app containers join to reach postgres/redis by hostname."
  type        = string
  default     = "apps"
}
