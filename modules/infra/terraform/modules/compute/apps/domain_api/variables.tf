variable "network_name" {
  description = "Docker network (from module.compute_data) to join for postgres/redis DNS resolution."
  type        = string
}

variable "postgres_host" {
  description = "Postgres hostname (from module.compute_data)."
  type        = string
}

variable "postgres_user" {
  description = "Postgres user/database name (from module.compute_data)."
  type        = string
}

variable "postgres_password" {
  description = "Postgres password — same value module.compute_data was given."
  type        = string
  sensitive   = true
}

variable "redis_host" {
  description = "Redis hostname (from module.compute_data)."
  type        = string
}

variable "registry_host" {
  description = "Registry host/port the api and worker images are pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "domain_api_keys" {
  description = "DOMAIN_API_KEYS value for the api container — comma-separated key:label pairs."
  type        = string
  sensitive   = true
}

variable "rate_limit_rps" {
  description = "Per-IP requests/sec allowed before a valid API key — see api's own README for why this only ever gates unauthenticated requests."
  type        = number
  default     = 1
}

variable "rate_limit_burst" {
  type    = number
  default = 5
}

variable "secrets_bridge_url" {
  description = "modules/compute/vaultwarden_bridge's internal_url output, or \"\" if that module doesn't exist yet — see its own README. Empty disables the bridge entirely; the app falls back to DATABASE_URL/DOMAIN_API_KEYS above."
  type        = string
  default     = ""
}

variable "secrets_bridge_api_key" {
  description = "Bearer token for secrets_bridge_url — same value as modules/compute/vaultwarden_bridge's bridge_api_key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "watchtower_enabled" {
  description = "Whether to label api/worker for modules/infra/watchtower to auto-redeploy on a new registry image. False by default: watchtower recreating these containers outside Terraform (new container ID each time) fights this module's own docker_container resources for ownership of the same name every time go-ci-cd.yml pushes -- go-ci-cd.yml's own `terraform apply -replace=...` is the actual redeploy mechanism now instead."
  type        = bool
  default     = false
}
