variable "network_name" {
  description = "Docker network to join. tela talks to nothing else here -- it's on the shared network only so cloudflared can reach it the same way every other app is reached."
  type        = string
}

variable "registry_host" {
  description = "Registry host the tela image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8000 is published on."
  type        = number
  default     = 8006
}

variable "watchtower_enabled" {
  description = "Same reasoning as the other app modules: false, since go-ci-cd.yml's own terraform apply -replace=... is the redeploy mechanism."
  type        = bool
  default     = false
}
