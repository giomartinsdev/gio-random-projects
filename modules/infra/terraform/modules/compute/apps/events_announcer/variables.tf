variable "app_name" {
  description = "Container name + registry image name -- must match the image python-ci-cd.yml pushes (events-announcer)."
  type        = string
  default     = "events-announcer"
}

variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join for redis DNS resolution."
  type        = string
}

variable "redis_host" {
  description = "Redis hostname (from module.storage_redis) -- the queue lives there."
  type        = string
}

variable "domain_events_queue" {
  description = "Redis list key drained into Discord (docker env DOMAIN_EVENTS_QUEUE) -- written by domain-worker's EventBus.Publish."
  type        = string
  default     = "domain.events.queue"
}

variable "announce_max_per_flush" {
  description = "Max deals announced per queue pass (docker env ANNOUNCE_MAX_PER_FLUSH). Overflow requeues at the head for the next pass."
  type        = number
  default     = 10
}

variable "announce_max_age_hours" {
  description = "Deals older than this are dropped, not announced (docker env ANNOUNCE_MAX_AGE_HOURS) -- anchored on the deal's own first-posted date."
  type        = number
  default     = 48
}

variable "announce_min_interval_s" {
  description = "Pause between Discord POSTs (docker env ANNOUNCE_MIN_INTERVAL_S) -- one message per deal, spread out to stay under Discord's rate limit."
  type        = number
  default     = 2
}

variable "announce_max_requeues" {
  description = "Failed postings requeue at the head at most this many times (docker env ANNOUNCE_MAX_REQUEUES, count rides in the event envelope) before being dropped -- announce is best-effort, never worth a DLQ."
  type        = number
  default     = 3
}

variable "registry_host" {
  description = "Registry host:port the announcer image is pulled from."
  type        = string
  default     = "registry.giomartins.dev:5000"
}

variable "discord_webhook_url" {
  description = "Discord channel webhook fresh deals get announced to (vault item DEALS_DISCORD_WEBHOOK_URL, injected by CI at apply time). Blank disables announcing -- the queue still drains, counted with outcome=dry."
  type        = string
  default     = ""
  sensitive   = true
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