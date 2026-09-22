variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- the contas-api shape: a published loopback port, state lives in domain-api's shared Postgres."
  type        = string
}

variable "registry_host" {
  description = "Registry host the clubs-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8017 is published on -- 8017 is clubs-api's slot in locals.tf's services (ingress routes clubs-api.giomartins.dev here; 8016 was the last taken, by apostas-api)."
  type        = number
  default     = 8017
}

variable "access_team_domain" {
  description = "Cloudflare Access team domain whose JWKS clubs-api verifies the Cf-Access-Jwt-Assertion header against -- same shape as bet-api's own teamDomain."
  type        = string
  default     = "giomartinsdev.cloudflareaccess.com"
}

variable "access_aud" {
  description = "Audience of the Access application in front of /api (see path_protected_hostnames in locals.tf) -- the token's aud must match this."
  type        = string
  default     = ""
}

variable "allowed_emails" {
  description = "Optional restriction to specific accounts, checked after the JWT verifies -- empty means anyone the Access policy admits."
  type        = list(string)
  default     = []
}

variable "frontend_origins" {
  description = "Origins allowed to call clubs-api cross-origin (CORS) -- clubs-frontend's MinIO-served origin plus the local dev server."
  type        = list(string)
  default     = ["https://clubs.giomartins.dev", "http://localhost:5173"]
}

variable "domain_api_url" {
  description = "Internal URL clubs-api's domain-api client talks to -- container-to-container on network_name, never the public hostname."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "clubs-api's own entry in domain-api's DOMAIN_API_KEYS (the \"clubs-api\" label) -- the per-person writes go through the command pipeline, so the audit log can name this caller."
  type        = string
  sensitive   = true
}

variable "otlp_endpoint" {
  description = "module.compute_services_observability's otlp_endpoint output. Logs flow separately via alloy's stdout scrape. Empty disables telemetry."
  type        = string
  default     = ""
}

variable "watchtower_enabled" {
  description = "false by default, same reasoning as post_api/contas_api: the app's own CI does terraform apply -replace=..., which is the actual redeploy mechanism."
  type        = bool
  default     = false
}
