variable "network_name" {
  description = "Docker network (from module.compute_data) to join for postgres DNS resolution -- and to reach domain-api by container name."
  type        = string
}

variable "postgres_host" {
  description = "Postgres hostname (from module.compute_data)."
  type        = string
}

variable "postgres_user" {
  description = "Postgres user/database name (from module.compute_data) -- post-api shares the same database as domain-api/worker; Better Auth's tables (singular \"user\") don't collide with domain's (plural \"users\")."
  type        = string
}

variable "postgres_password" {
  description = "Postgres password — same value module.compute_data was given."
  type        = string
  sensitive   = true
}

variable "registry_host" {
  description = "Registry host/port the post-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "hostname" {
  description = "Public hostname post-api is reached at -- used for Better Auth's own baseURL/cookie domain."
  type        = string
  default     = "post-api.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8000 is published on -- 8000 is already taken by domain-api on the same host."
  type        = number
  default     = 8002
}

variable "better_auth_secret" {
  description = "Better Auth's session-signing secret."
  type        = string
  sensitive   = true
}

variable "domain_api_url" {
  description = "Internal URL post-api's domain-api client talks to -- container-to-container on network_name, never the public domain.giomartins.dev."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "post-api's own entry in domain-api's DOMAIN_API_KEYS (the \"post-api\" label, not the \"ci\" one CI itself uses)."
  type        = string
  sensitive   = true
}

variable "watchtower_enabled" {
  description = "Same reasoning as modules/compute/app's own variable of the same name: false by default, since apps-deploy.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}
