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

variable "extension_token" {
  description = "The static shared secret the betting-slip Chrome extension sends as X-Extension-Token -- see random_password.apostas_extension_token in the root module. Empty disables the extension's route entirely."
  type        = string
  sensitive   = true
}

variable "extension_usuario_email" {
  description = "The one financas account the extension registers bets as -- see var.apostas_extension_usuario_email in the root module."
  type        = string
}

variable "ai_base_url" {
  description = "The OpenAI-compatible endpoint apostas-api's vision client posts to -- defaults to 9router's internal docker-network address (module.compute_services_ai_proxy, REQUIRE_API_KEY=false there)."
  type        = string
  default     = "http://9router:20128/v1"
}

variable "ai_model" {
  description = "Comma-separated cascade of model names to try for reading a betting-slip screenshot -- MUST name a vision-capable model (empty falls back to auto-discovery, which cannot tell a vision model from a text-only one; verify against the live 9router model list before relying on this). Default is 9router's own \"vision\" combo (Combo & Vision Adapter in its dashboard), a fallback pool of vision-capable models."
  type        = string
  default     = "vision"
}

variable "ai_api_key" {
  description = "9router's own API key -- the ai_proxy module's REQUIRE_API_KEY=false only ever applied to the boot-time default; the dashboard's \"Require API key\" toggle can (and here does) override that live, so a real key is needed regardless of network trust. See modules/compute/services/ai_proxy's own dashboard for the current key."
  type        = string
  sensitive   = true
  default     = ""
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
