variable "network_name" {
  description = "Docker network (from module.network_docker_apps) to join -- the only way to bet-api is by container name on it."
  type        = string
}

variable "registry_host" {
  description = "Registry host/port the bet-runner image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "bet_api_url" {
  description = "Internal URL of bet-api -- container-to-container on network_name, never the public hostname (the edge's Access redirect would eat every /internal call)."
  type        = string
  default     = "http://bet-api:8009"
}

variable "runner_api_key" {
  description = "Shared secret presented on /internal/* (X-Runner-Key) -- same value bet-api got (random_password.runner_api_key in the root config)."
  type        = string
  sensitive   = true
}

variable "dry_run" {
  description = <<-EOT
    TRUE by default, on purpose: the runner walks every flow (open link,
    login, fill stake, screenshot) but NEVER clicks the final confirm.
    Flip to false only after selectors are verified against the real
    site with receipts in hand -- this variable is the single switch
    between rehearsal and real money.
  EOT
  type        = bool
  default     = true
}

variable "profiles_volume" {
  description = "Docker volume holding the persistent browser profiles (bookmaker sessions survive runner restarts). Created here; wiping it logs every account out."
  type        = string
  default     = "bet-runner-profiles"
}

variable "memory" {
  description = "Container memory cap (MB) -- a logged-in Chromium session needs real headroom (FlareSolverr's 768 is the floor for a solved challenge, a live session wants double)."
  type        = number
  default     = 2048
}

variable "shm_size" {
  description = "Size of /dev/shm in BYTES (kreuzwerker's unit) -- Chrome's shared memory; the default 64MB crashes tab rendering under load, 512MB is the safe floor."
  type        = number
  default     = 536870912
}

variable "poll_interval_ms" {
  description = "How often the runner polls bet-api for queued bets (ms) -- 5s keeps the perceived latency low without hammering the BFF."
  type        = number
  default     = 5000
}

variable "bet_timeout_ms" {
  description = "Wall-clock cap per bet (ms) -- the drivers have their own inner timeouts; this is the outer seatbelt so a hung page can't wedge the poller."
  type        = number
  default     = 180000
}

variable "watchtower_enabled" {
  description = "Same reasoning as the other apps' variable of the same name: false by default, since ts-backend-ci-cd.yml's -replace dispatch is the actual redeploy mechanism."
  type        = bool
  default     = false
}

variable "otlp_endpoint" {
  description = <<-EOT
    module.compute_services_observability's otlp_endpoint output — where
    the claim/report traces go. Logs flow via alloy's docker-socket
    scrape of stdout. Empty disables telemetry entirely.
  EOT
  type        = string
  default     = ""
}