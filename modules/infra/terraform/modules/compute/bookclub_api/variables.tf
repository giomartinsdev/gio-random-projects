variable "network_name" {
  description = "Docker network (from module.compute_data) to join for postgres DNS resolution."
  type        = string
}

variable "postgres_host" {
  description = "Postgres hostname (from module.compute_data)."
  type        = string
}

variable "postgres_user" {
  description = "Postgres user/database name (from module.compute_data) -- bookclub-api shares the same database as post-api/domain-api, own tables prefixed bookclub_ so nothing collides."
  type        = string
}

variable "postgres_password" {
  description = "Postgres password — same value module.compute_data was given."
  type        = string
  sensitive   = true
}

variable "registry_host" {
  description = "Registry host/port the bookclub-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "hostname" {
  description = "Public hostname bookclub-api is reached at -- used for Better Auth's own baseURL and must share crossSubDomainCookies' parent domain with post-api."
  type        = string
  default     = "bookclub-api.giomartins.dev"
}

variable "frontend_origins" {
  description = "Origins allowed to call bookclub-api cross-origin (CORS) and trusted by Better Auth for its CSRF check."
  type        = list(string)
  default     = ["https://classroom-bdd.giomartins.dev", "http://localhost:5173"]
}

variable "external_port" {
  description = "Host port the container's internal :8000 is published on."
  type        = number
  default     = 8004
}

variable "better_auth_secret" {
  description = "Same value as post-api's own better_auth_secret -- NOT a separate secret. Sessions post-api creates must validate here too; a different secret would break that. See src/lib/auth.ts."
  type        = string
  sensitive   = true
}

variable "domain_api_url" {
  description = "Internal URL bookclub-api's domain-api client (Room/Message CQRS + the SSE relay) talks to -- container-to-container on network_name, never the public domain.giomartins.dev."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "bookclub-api's own entry in domain-api's DOMAIN_API_KEYS (the \"bookclub-api\" label, not post-api's or ci's)."
  type        = string
  sensitive   = true
}

variable "watchtower_enabled" {
  description = "Same reasoning as modules/compute/app's own variable of the same name: false by default, since ts-ci-cd.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}
