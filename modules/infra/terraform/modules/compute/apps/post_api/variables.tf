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

variable "frontend_origins" {
  description = "Origins allowed to call post-api cross-origin (CORS) and trusted by Better Auth for its CSRF check."
  type        = list(string)
  default     = ["https://buteco-class.giomartins.dev", "http://localhost:5173"]
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

variable "discord_client_id" {
  description = "Discord Application's client ID for the buteco-class Discord Activity -- blank until that app is registered in the Discord Developer Portal. Safe to be non-secret (it's public in the frontend bundle too), kept alongside the secret below purely so both halves of this feature toggle together."
  type        = string
  default     = ""
}

variable "discord_client_secret" {
  description = "Matching client secret -- server-side only, exchanges the Activity's OAuth code for an access token (routes/discord.ts). Blank disables the /discord/token route entirely (see index.ts's discord ? ... : undefined)."
  type        = string
  default     = ""
  sensitive   = true
}

# --- post images (MinIO) ---

variable "minio_endpoint" {
  description = "MinIO's internal host:port (module.storage_minio's endpoint output, container-to-container on network_name) -- post-api uploads post images here (see lib/minioClient.ts). Empty disables the /images route entirely."
  type        = string
  default     = ""
}

variable "minio_access_key" {
  description = "MinIO root user -- same value module.storage_minio got (its root user doubles as the S3 API key; there are no sub-users)."
  type        = string
  default     = ""
}

variable "minio_secret_key" {
  description = "Matching MinIO root password."
  type        = string
  default     = ""
  sensitive   = true
}

variable "minio_bucket" {
  description = "Bucket for post images -- buteco-media, pre-created public-read by static_sites.tf (ingress serves it at media.giomartins.dev)."
  type        = string
  default     = "buteco-media"
}

variable "media_base_url" {
  description = "Public base URL image uploads are served from -- what gets baked into posts' markdown/coverImageUrl. Must match the static_sites hostname (media.giomartins.dev)."
  type        = string
  default     = "https://media.giomartins.dev"
}

variable "watchtower_enabled" {
  description = "Same reasoning as modules/compute/app's own variable of the same name: false by default, since go-ci-cd.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}

variable "otlp_endpoint" {
  description = <<-EOT
    module.compute_services_observability's otlp_endpoint output — where
    traces and metrics go. Logs are NOT sent here: they flow via alloy's
    docker-socket scrape of stdout (structured JSON like pino already
    emits), so no log exporter ships in the bundle. Empty disables
    telemetry entirely — the telemetry module no-ops and local dev never
    needs a collector running.
  EOT
  type        = string
  default     = ""
}
