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
    Where browsers should send media -- an IP or a hostname (resolved
    once at startup). Media is WebRTC: UDP straight to this host, so
    whatever goes here must route to the machine itself. On the VPS
    that's simply its static public IP (the root module passes
    var.server_ip) -- no DNS indirection needed.

    Empty means the SFU advertises the container's private address and
    no browser can connect -- the app logs a warning at startup when
    that happens.
  EOT
  type        = string
  default     = ""
}

variable "sfu_udp_port" {
  description = "Single UDP port carrying all media (ICE mux). Published unmapped, since the port number is baked into the ICE candidates the SFU advertises."
  type        = number
  default     = 7881
}
