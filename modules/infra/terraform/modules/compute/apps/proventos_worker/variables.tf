variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- reaches domain-api by container name."
  type        = string
}

variable "registry_host" {
  description = "Registry host the proventos-worker image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "domain_api_url" {
  description = "Internal URL proventos-worker's domain-api client talks to -- container-to-container on network_name (bridge, not host networking)."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "proventos-worker's own X-API-Key for the domain-api command pipeline."
  type        = string
  sensitive   = true
}

variable "poll_interval_seconds" {
  description = "How often the worker sweeps every ativo for new dividends, in seconds -- default once a day."
  type        = number
  default     = 24 * 60 * 60
}

variable "watchtower_enabled" {
  description = "Same reasoning as every other app module's own variable of the same name: false by default, since go-ci-cd.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}
