variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- no runtime dependency on it (state lives in domain-api's shared Postgres), it's the bet_api/harness_api shape every published-port app here joins."
  type        = string
}

variable "registry_host" {
  description = "Registry host the apostas-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8016 is published on -- 8016 is apostas-api's slot in locals.tf's services (ingress routes apostas-api.giomartins.dev here), the next free one after leads-api's 8015."
  type        = number
  default     = 8016
}

variable "session_secret" {
  description = "The HS256 secret apostas-api verifies the financas_session cookie with -- contas-api is the one service that mints it, see random_password.financas_session_secret in the root module."
  type        = string
  sensitive   = true
}

variable "allowed_emails" {
  description = "Optional restriction to a specific set of accounts, checked after the session cookie verifies -- empty means anyone with a Google account can sign up (financas is open signup by design)."
  type        = list(string)
  default     = []
}

variable "frontend_origins" {
  description = "Origins allowed to call apostas-api cross-origin (CORS) -- financas-frontend's origin and the local dev server."
  type        = list(string)
  default     = ["https://financas.giomartins.dev", "http://localhost:5173"]
}

variable "domain_api_url" {
  description = "Internal URL apostas-api's domain-api client talks to -- container-to-container on network_name (bridge, not host networking), never the public *.giomartins.dev hostname."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "apostas-api's own entry in domain-api's DOMAIN_API_KEYS (the \"apostas-api\" label) -- bets and transações go through the command pipeline, so the audit log can name this caller."
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
