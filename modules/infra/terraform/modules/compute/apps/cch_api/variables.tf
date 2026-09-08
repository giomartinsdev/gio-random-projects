variable "registry_host" {
  description = "Registry host the cch-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's HTTP side binds on."
  type        = number
  default     = 8008
}

variable "frontend_origins" {
  description = "cch-frontend's own origin(s) -- the only ones the REST API sends CORS headers for and the WebSocket accepts a connection from. Same convention as tela_api's frontend_origins."
  type        = list(string)
  default     = []
}

variable "watchtower_enabled" {
  description = "Same reasoning as the other app modules: false, since go-ci-cd.yml's own terraform apply -replace=... is the redeploy mechanism."
  type        = bool
  default     = false
}

variable "domain_api_url" {
  description = "Internal URL cch-api's domain-api client talks to. Loopback, not the container DNS name post-api uses: this container is network_mode=host, so its localhost IS the VPS's, and domain-api publishes 127.0.0.1:8000 there (same wiring as CCH_AI_BASE_URL)."
  type        = string
  default     = "http://127.0.0.1:8000"
}

variable "domain_api_key" {
  description = "cch-api's own entry in domain-api's DOMAIN_API_KEYS (the \"cch-api\" label) -- rooms and decks go through the command pipeline now, so the audit log can name this caller."
  type        = string
  sensitive   = true
  default     = ""
}