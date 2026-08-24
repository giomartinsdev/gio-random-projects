variable "network_name" {
  description = "Docker network to join -- front doesn't actually need to reach anything on it (it's a static bundle calling post-api's public URL from the browser), joins purely for consistency/observability with the rest of the stack."
  type        = string
}

variable "registry_host" {
  description = "Registry host/port the front image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "hostname" {
  description = "Public hostname front is reached at."
  type        = string
  default     = "classroom-bdd.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :80 is published on."
  type        = number
  default     = 8003
}

variable "watchtower_enabled" {
  type    = bool
  default = false
}
