variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- no runtime dependency on it (state lives in domain-api's shared Postgres), it's the bet_api/harness_api shape every published-port app here joins."
  type        = string
}

variable "registry_host" {
  description = "Registry host the dashboard-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8014 is published on -- 8014 is dashboard-api's slot in locals.tf's services (ingress routes dashboard-api.giomartins.dev here)."
  type        = number
  default     = 8014
}

variable "access_team_domain" {
  description = "The Cloudflare Access team domain this zone belongs to -- the app composes DASHBOARD_ACCESS_ISSUER from it and fetches the team's JWKS from <issuer>/cdn-cgi/access/certs to verify the edge-injected Cf-Access-Jwt-Assertion."
  type        = string
  default     = "workwithgiomartinsdev.cloudflareaccess.com"
}

variable "access_aud" {
  description = "The `aud` tag of the dashboard-api Access application (module.cloud_cloudflare.access_app_auds output; the single /api app, login hop included) -- every Access JWT minted for it carries this aud, and dashboard-api pins it as the acceptable token audience."
  type        = list(string)
}

variable "allowed_emails" {
  description = "Defense-in-depth email allowlist checked after the Access JWT verifies (the edge's Google-SSO policy already enforces the same list)."
  type        = list(string)
  default     = ["giovannidealmeidamartins@gmail.com", "workwithgiomartinsdev@gmail.com"]
}

variable "frontend_origins" {
  description = "Origins allowed to call dashboard-api cross-origin (CORS) and accepted by /api/sso's return-parameter allowlist -- financas-frontend's origin and the local dev server."
  type        = list(string)
  default     = ["https://financas.giomartins.dev", "http://localhost:5173"]
}

variable "domain_api_url" {
  description = "Internal URL dashboard-api's domain-api client talks to -- container-to-container on network_name (bridge, not host networking), never the public *.giomartins.dev hostname."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "dashboard-api's own entry in domain-api's DOMAIN_API_KEYS (the \"dashboard-api\" label) -- dashboard layouts go through the command pipeline, so the audit log can name this caller."
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
