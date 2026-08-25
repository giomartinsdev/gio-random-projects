variable "hostname" {
  description = "Public hostname Adminer is reachable at — must match the Cloudflare Tunnel ingress rule pointing at var.published_port."
  type        = string
  default     = "adminer.giomartins.dev"
}

variable "published_port" {
  description = "Host port the container's internal :8080 is published on — what the tunnel's ingress rule for var.hostname must point at."
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
