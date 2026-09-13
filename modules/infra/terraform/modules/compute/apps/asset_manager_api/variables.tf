variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- no runtime dependency on it (state lives in domain-api's shared Postgres), it's the bet_api/harness_api shape every published-port app here joins."
  type        = string
}

variable "registry_host" {
  description = "Registry host the asset-manager-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8013 is published on -- 8013 is asset-manager-api's slot in locals.tf's services (ingress routes asset-manager-api.giomartins.dev here)."
  type        = number
  default     = 8013
}

variable "session_secret" {
  description = "The HS256 secret asset-manager-api verifies the financas_session cookie with -- contas-api is the one service that mints it, see random_password.financas_session_secret in the root module."
  type        = string
  sensitive   = true
}

variable "allowed_emails" {
  description = "Optional restriction to a specific set of accounts, checked after the session cookie verifies -- empty means anyone with a Google account can sign up (financas is open signup by design)."
  type        = list(string)
  default     = []
}

variable "frontend_origins" {
  description = "Origins allowed to call asset-manager-api cross-origin (CORS) and accepted by /api/sso's return-parameter allowlist -- financas-frontend's origin and the local dev server."
  type        = list(string)
  default     = ["https://financas.giomartins.dev", "http://localhost:5173"]
}

variable "domain_api_url" {
  description = "Internal URL asset-manager-api's domain-api client talks to -- container-to-container on network_name (bridge, not host networking), never the public *.giomartins.dev hostname."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "asset-manager-api's own entry in domain-api's DOMAIN_API_KEYS (the \"asset-manager-api\" label) -- assets/movements go through the command pipeline, so the audit log can name this caller."
  type        = string
  sensitive   = true
}

variable "brapi_token" {
  description = "brapi.dev API token used to fetch stock/fund market quotes -- no default, real value comes from var.asset_manager_brapi_token at the root, never committed."
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
