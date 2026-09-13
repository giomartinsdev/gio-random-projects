variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- no runtime dependency on it (state lives in domain-api's shared Postgres), it's the bet_api/harness_api shape every published-port app here joins."
  type        = string
}

variable "registry_host" {
  description = "Registry host the contas-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8011 is published on -- 8011 is contas-api's slot in locals.tf's services (ingress routes contas-api.giomartins.dev here)."
  type        = number
  default     = 8011
}

variable "session_secret" {
  description = "The HS256 secret contas-api signs the financas_session cookie with, after verifying the caller's Google ID token -- shared with the other 3 financas backends (they only verify), see random_password.financas_session_secret in the root module."
  type        = string
  sensitive   = true
}

variable "session_cookie_domain" {
  description = "Domain attribute of the financas_session cookie -- .giomartins.dev so it's readable by all 4 financas backend subdomains, not just contas-api's own."
  type        = string
  default     = ".giomartins.dev"
}

variable "session_duration_seconds" {
  description = "How long a financas session lasts, in seconds, before the cookie expires and the person has to sign in again -- FINANCAS_SESSION_DURATION is read as a plain second count, not a Go duration string."
  type        = number
  default     = 30 * 24 * 60 * 60 # 30 days
}

variable "google_oauth_client_id" {
  description = "The Google OAuth 2.0 Web application Client ID contas-api verifies every Google ID token's audience against -- see var.google_oauth_client_id in the root module."
  type        = string
}

variable "allowed_emails" {
  description = "Optional restriction to a specific set of accounts, checked after the Google ID token verifies -- empty means anyone with a Google account can sign up (financas is open signup by design)."
  type        = list(string)
  default     = []
}

variable "frontend_origins" {
  description = "Origins allowed to call contas-api cross-origin (CORS) and accepted by /api/sso's return-parameter allowlist -- financas-frontend's origin and the local dev server."
  type        = list(string)
  default     = ["https://financas.giomartins.dev", "http://localhost:5173"]
}

variable "domain_api_url" {
  description = "Internal URL contas-api's domain-api client talks to -- container-to-container on network_name (bridge, not host networking), never the public *.giomartins.dev hostname."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "contas-api's own entry in domain-api's DOMAIN_API_KEYS (the \"contas-api\" label) -- accounts go through the command pipeline, so the audit log can name this caller."
  type        = string
  sensitive   = true
}

variable "otlp_endpoint" {
  description = <<-EOT
    module.compute_services_observability's otlp_endpoint output -- where
    traces and metrics go. Logs are NOT sent here: they flow via alloy's
    docker-socket scrape of stdout. Empty disables telemetry entirely.
  EOT
  type        = string
  default     = ""
}

variable "watchtower_enabled" {
  description = "Same reasoning as modules/compute/apps/post_api's own variable of the same name: false by default, since go-ci-cd.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}
