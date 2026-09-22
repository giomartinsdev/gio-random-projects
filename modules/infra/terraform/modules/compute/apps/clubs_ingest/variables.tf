variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- a worker only talks outbound to domain-api, same as proventos_worker."
  type        = string
}

variable "registry_host" {
  description = "Registry host the clubs-ingest image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "domain_api_url" {
  description = "Internal URL the worker's domain-api client talks to."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "clubs-ingest's own entry in domain-api's DOMAIN_API_KEYS (the \"clubs-ingest\" label) -- a SEPARATE key from clubs-api's, so the audit log distinguishes a worker write from a BFF write."
  type        = string
  sensitive   = true
}

variable "poll_seconds" {
  description = "Seconds between ingest cycles. The per-endpoint TTLs inside the cycle mean a short poll does not re-fetch everything."
  type        = number
  default     = 900
}

variable "ttl_matches" {
  description = "How long a club's matches stay fresh before being re-fetched, in seconds -- matches are the expensive call, so the shortest TTL."
  type        = number
  default     = 300
}

variable "ttl_squad" {
  description = "How long a club's squad and all-time totals stay fresh, in seconds."
  type        = number
  default     = 3600
}

variable "discord_webhook_url" {
  description = "Optional Discord webhook the worker announces results and records to. Empty means the worker collects silently, which is the default and never breaks the cycle."
  type        = string
  default     = ""
  sensitive   = true
}

variable "otlp_endpoint" {
  description = "module.compute_services_observability's otlp_endpoint output. Logs flow separately via alloy's stdout scrape. Empty disables telemetry."
  type        = string
  default     = ""
}

variable "watchtower_enabled" {
  description = "false by default, same reasoning as the other workers: the app's own CI does terraform apply -replace=...."
  type        = bool
  default     = false
}
