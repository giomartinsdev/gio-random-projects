variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join for postgres DNS resolution."
  type        = string
}

variable "postgres_host" {
  description = "Postgres hostname (from module.storage_postgres)."
  type        = string
}

variable "postgres_user" {
  description = "Postgres user/database name (from module.storage_postgres) -- bet-api shares the same database as every other app here; its tables are bet_-prefixed so nothing collides."
  type        = string
}

variable "postgres_password" {
  description = "Postgres password — same value module.storage_postgres was given."
  type        = string
  sensitive   = true
}

variable "registry_host" {
  description = "Registry host/port the bet-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8009 is published on -- 8009 is bet-api's slot in locals.tf's services (ingress routes bet-api.giomartins.dev here)."
  type        = number
  default     = 8009
}

variable "frontend_origins" {
  description = "Origins allowed to call bet-api cross-origin (CORS) and accepted by /api/sso's return-parameter allowlist -- the SPA's origin and the local dev server."
  type        = list(string)
  default     = ["https://bet.giomartins.dev", "http://localhost:5173"]
}

variable "access_team_domain" {
  description = "The Cloudflare Access team domain this zone belongs to -- lib/accessAuth.ts verifies the edge-injected Cf-Access-Jwt-Assertion against <team>/cdn-cgi/access/certs."
  type        = string
  default     = "workwithgiomartinsdev.cloudflareaccess.com"
}

variable "access_aud" {
  description = "The `aud` tags of the bet-api Access applications (module.cloud_cloudflare.access_app_auds output; a single app today: /api, login hop included) -- every Access JWT minted for one of those apps carries its app's aud, and bet-api pins the whole set as acceptable token audiences (comma-joined into BET_ACCESS_AUD)."
  type        = list(string)
}

variable "allowed_emails" {
  description = "Defense-in-depth email allowlist checked after the Access JWT verifies (the edge's Google-SSO policy already enforces the same list)."
  type        = list(string)
  default     = ["giovannidealmeidamartins@gmail.com", "workwithgiomartinsdev@gmail.com"]
}

variable "credentials_key" {
  description = "AES-256-GCM key (32 bytes as 64 hex chars) that encrypts bookmaker credentials at rest (src/lib/crypto.ts). random_password.bet_credentials_key in the root config."
  type        = string
  sensitive   = true
}

variable "runner_api_key" {
  description = "Shared secret bet-runner presents on /internal/* (X-Runner-Key) -- the runner lives on the home network now and calls this API over the public hostname, so this header is /internal's only auth."
  type        = string
  sensitive   = true
}

variable "watchtower_enabled" {
  description = "Same reasoning as modules/compute/apps/post_api's own variable of the same name: false by default, since ts-backend-ci-cd.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}

variable "otlp_endpoint" {
  description = <<-EOT
    module.compute_services_observability's otlp_endpoint output — where
    traces and metrics go. Logs are NOT sent here: they flow via alloy's
    docker-socket scrape of stdout (structured JSON like pino already
    emits). Empty disables telemetry entirely.
  EOT
  type        = string
  default     = ""
}