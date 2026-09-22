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

variable "session_secret" {
  description = "The HS256 secret clubs-api signs its session cookie with, after verifying the caller's Google ID token. Generated in the root module (random_password.clubs_session_secret) and never leaves the infrastructure."
  type        = string
  sensitive   = true
}

variable "session_cookie_domain" {
  description = <<-EOT
    Domain attribute of the clubs_session cookie. Empty means host-only, which
    is the right default for the local dev setup (localhost ignores port, so
    the SPA on :5173 and the API on :8017 share it). Set to
    ".giomartins.dev" only if something other than clubs-api's own host ever
    needs to read the session.
  EOT
  type        = string
  default     = ""
}

variable "google_oauth_client_id" {
  description = "The Google OAuth 2.0 Web application Client ID whose ID tokens clubs-api accepts -- clubs' OWN client, separate from financas': Google registers the JavaScript origins per client, and sharing one across products is what caused clubs' origin_mismatch. Not secret (it is public in every ID token's aud claim and in the bundle)."
  type        = string
  default     = ""
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
