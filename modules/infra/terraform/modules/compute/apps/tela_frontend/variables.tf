variable "network_name" {
  description = "Docker network to join -- tela-frontend doesn't actually need to reach anything on it (it's a static bundle calling tela-api's public URL from the browser), joins purely for consistency/observability with the rest of the stack."
  type        = string
}

variable "registry_host" {
  description = "Registry host/port the tela-frontend image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "hostname" {
  description = "Public hostname tela-frontend is reached at."
  type        = string
  default     = "tela.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :80 is published on."
  type        = number
  default     = 8006
}

variable "watchtower_enabled" {
  type    = bool
  default = false
}
