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

variable "watchtower_enabled" {
  description = "Whether to label api/worker for modules/infra/watchtower to auto-redeploy on a new registry image. False by default: watchtower recreating these containers outside Terraform (new container ID each time) fights this module's own docker_container resources for ownership of the same name every time apps-deploy.yml pushes -- see domain_api_image_tag/domain_worker_image_tag below for the actual redeploy mechanism instead."
  type        = bool
  default     = false
}

variable "domain_api_image_tag" {
  description = "Tag of the domain-api image to run — apps-deploy.yml overrides this to the exact git SHA it just pushed, so a fresh apply pins and deploys that build instead of floating on a mutable :latest a second, unrelated tool could recreate the container out from under Terraform's own state."
  type        = string
  default     = "latest"
}

variable "domain_worker_image_tag" {
  description = "Same as domain_api_image_tag, for domain-worker."
  type        = string
  default     = "latest"
}
