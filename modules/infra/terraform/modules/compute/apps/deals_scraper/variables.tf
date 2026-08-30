variable "app_name" {
  description = "Container name + registry image name -- one scraper module instance per source (pld-scraper, phb-scraper, ...). Must match the image python-ci-cd.yml pushes."
  type        = string
}

variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join for postgres DNS resolution."
  type        = string
}

variable "postgres_host" {
  description = "Postgres hostname (from module.storage_postgres)."
  type        = string
}

variable "postgres_user" {
  description = "Postgres user/database name -- every app shares the one shared database; raw_deals is the scraper worker's only table."
  type        = string
}

variable "postgres_password" {
  description = "Postgres password -- same value the other app modules got."
  type        = string
  sensitive   = true
}

variable "registry_host" {
  description = "Registry host:port the scraper image is pulled from."
  type        = string
  default     = "registry.giomartins.dev:5000"
}

variable "source_base_url" {
  description = "The source's public feed API base URL (docker env SOURCE_BASE_URL -- client.py refuses to run without it). Lives in Vaultwarden as a per-source item; CI injects TF_VAR_* at apply time. Blank leaves the container crash-looping on purpose -- a silent no-op poller would be worse."
  type        = string
  default     = ""
  sensitive   = true
}

variable "poll_seconds" {
  description = "Polling cadence (docker env POLL_SECONDS) -- how often the worker fetches a page from its source."
  type        = number
  default     = 1800
}

variable "discord_webhook_url" {
  description = "Discord channel webhook INSERTED deals get announced to (deals_common.discord). Blank disables announcing -- raw_deals still fills up silently."
  type        = string
  default     = ""
  sensitive   = true
}

variable "watchtower_enabled" {
  description = "Same reasoning as modules/compute/app's own variable of the same name: false by default, since python-ci-cd.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}