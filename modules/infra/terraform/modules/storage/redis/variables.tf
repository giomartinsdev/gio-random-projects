variable "redis_image" {
  description = "Redis image tag."
  type        = string
  default     = "redis:7-alpine"
}

variable "network_name" {
  description = "Name of the docker network (from network/docker_apps)."
  type        = string
  default     = "apps"
}
