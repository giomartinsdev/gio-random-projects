variable "app_name" {
  description = "Container name + registry image name -- one scraper module instance per source (pld-scraper, phb-scraper, ...). Must match the image python-ci-cd.yml pushes."
  type        = string
}

variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join for domain-api DNS resolution."
  type        = string
}

variable "domain_api_url" {
  description = "domain-api base URL (docker env DOMAIN_API_URL) -- POST /deals is the scraper's only write path."
  type        = string
  default     = "http://domain-api:8000"
}

variable "domain_api_key" {
  description = "domain-api API key for the scrapers (docker env DOMAIN_API_KEY) -- from secrets.tf's random_id.deals_domain_key."
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

variable "otlp_endpoint" {
  description = "OTLP/HTTP collector base URL (from module.compute_services_observability). Empty disables telemetry entirely."
  type        = string
  default     = ""
}

variable "watchtower_enabled" {
  description = "Same reasoning as modules/compute/app's own variable of the same name: false by default, since python-ci-cd.yml's own terraform apply -replace=... is the actual redeploy mechanism."
  type        = bool
  default     = false
}