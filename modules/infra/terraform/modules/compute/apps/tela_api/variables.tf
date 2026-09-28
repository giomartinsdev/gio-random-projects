variable "registry_host" {
  description = "Registry host the tela-api image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8000 is published on."
  type        = number
  default     = 8007
}

variable "frontend_origins" {
  description = "tela-frontend's own origin(s) -- the only ones the REST API sends CORS headers for and the WebSocket accepts a connection from. Same convention as bookclub-api/post-api/classroom-api's frontend_origins."
  type        = list(string)
  default     = []
}

variable "watchtower_enabled" {
  description = "Same reasoning as the other app modules: false, since go-ci-cd.yml's own terraform apply -replace=... is the redeploy mechanism."
  type        = bool
  default     = false
}

variable "sfu_public_host" {
  description = <<-EOT
    Where browsers should send media -- an IP or a hostname. Media is
    WebRTC: UDP straight to this host, so whatever goes here must route
    to the machine itself. On the VPS that's simply its static public IP
    (the root module passes var.server_ip) -- no DNS indirection needed.

    Empty makes MediaMTX advertise internal addresses and no browser can
    connect, which shows up only as video that never starts.
  EOT
  type        = string
  default     = ""
}

variable "mediamtx_udp_port" {
  description = "Single UDP+TCP port carrying all MediaMTX media (ICE/DTLS). Binds unmapped on the host, since the port number is baked into the ICE candidates MediaMTX advertises. Matches the VPS security list's TCP+UDP opening."
  type        = number
  default     = 8217
}

variable "mediamtx_public_host" {
  description = "Address MediaMTX advertises in its ICE candidates. Same value as sfu_public_host on the VPS (the machine's static public IP)."
  type        = string
  default     = ""
}

variable "mediamtx_private_host" {
  description = <<-EOT
    The host's private address, also advertised by MediaMTX. Needed so the
    coturn relay -- which runs on the SAME host and therefore can't reach
    the public IP (Oracle doesn't hairpin) -- can deliver media to
    MediaMTX over the private address. Empty means it isn't advertised
    (no relay on this host, or relay handled elsewhere).
  EOT
  type        = string
  default     = ""
}

variable "coturn_enabled" {
  description = "Run a self-hosted coturn (free TURN relay) alongside MediaMTX. Off means STUN-only unless another TURN is configured."
  type        = bool
  default     = false
}

variable "coturn_secret" {
  description = "coturn's static-auth-secret, shared with tela-api so it can mint short-lived TURN credentials. Generated in the root module (secrets.tf); empty disables coturn."
  type        = string
  default     = ""
  sensitive   = true
}

variable "coturn_public_host" {
  description = "Public address coturn advertises to browsers (its external-ip). Same public IP as the host."
  type        = string
  default     = ""
}

variable "coturn_listen_port" {
  description = "coturn's STUN/TURN listener port (udp+tcp). Must be open in the VPS firewall."
  type        = number
  default     = 3478
}

variable "coturn_relay_min_port" {
  description = "First UDP port of coturn's relay allocation range. The whole range must be open in the VPS firewall."
  type        = number
  default     = 49160
}

variable "coturn_relay_max_port" {
  description = "Last UDP port of coturn's relay allocation range."
  type        = number
  default     = 49200
}

variable "otlp_endpoint" {
  description = <<-EOT
    module.compute_services_observability's otlp_endpoint_loopback
    output — this container is network_mode = host, so it can't resolve
    docker-network names and reaches alloy over the host's loopback
    instead. Traces + metrics only; logs flow via alloy's docker-socket
    scrape of stdout. Empty disables telemetry entirely — the telemetry
    package no-ops and local dev never needs a collector running.
  EOT
  type        = string
  default     = ""
}

variable "stun_urls" {
  description = "Space/comma-separated STUN URLs handed to the browser. Empty uses the app's own default (Google STUN)."
  type        = string
  default     = ""
}

variable "turn_urls" {
  description = <<-EOT
    Space/comma-separated static TURN URLs (e.g. a self-hosted coturn:
    turn:host:3478?transport=udp turn:host:3478?transport=tcp). When set,
    the browser is pinned to the relay and turn_username/turn_password are
    sent with it. Empty means no static TURN.
  EOT
  type        = string
  default     = ""
}

variable "turn_username" {
  description = "Username for the static TURN above. Ignored when turn_urls is empty."
  type        = string
  default     = ""
}

variable "turn_password" {
  description = "Password for the static TURN above. Sourced from the vault at apply time, never the repo."
  type        = string
  default     = ""
  sensitive   = true
}

variable "turn_cf_key_id" {
  description = "Cloudflare Realtime TURN key id. With turn_cf_api_token set, the app mints short-lived TURN credentials server-side and never exposes the account token. Takes priority over the static TURN."
  type        = string
  default     = ""
}

variable "turn_cf_api_token" {
  description = "Cloudflare API token that may mint TURN credentials for turn_cf_key_id. Sourced from the vault at apply time."
  type        = string
  default     = ""
  sensitive   = true
}
