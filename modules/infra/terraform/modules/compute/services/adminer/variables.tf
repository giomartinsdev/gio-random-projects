variable "hostname" {
  description = "Public hostname Adminer is reachable at — must match locals.tf's service entry for var.published_port."
  type        = string
  default     = "adminer.giomartins.dev"
}

variable "published_port" {
  description = "Host port the container's internal :8080 is published on — what locals.tf's service entry for var.hostname must match."
  type        = number
  default     = 8092
}

variable "adminer_version" {
  description = "adminer:<version> image tag."
  type        = string
  default     = "latest"
}

variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join — lets Adminer reach the postgres container by name (\"postgres\")."
  type        = string
}
