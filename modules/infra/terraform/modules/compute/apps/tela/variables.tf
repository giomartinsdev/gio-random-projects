variable "network_name" {
  description = "Docker network to join. tela talks to nothing else here -- it's on the shared network only so cloudflared can reach it the same way every other app is reached."
  type        = string
}

variable "registry_host" {
  description = "Registry host the tela image is pulled from."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "external_port" {
  description = "Host port the container's internal :8000 is published on."
  type        = number
  default     = 8006
}

variable "watchtower_enabled" {
  description = "Same reasoning as the other app modules: false, since go-ci-cd.yml's own terraform apply -replace=... is the redeploy mechanism."
  type        = bool
  default     = false
}

variable "sfu_public_ip" {
  description = <<-EOT
    Address browsers should send media to. Not reachable through the
    Cloudflare tunnel -- WebRTC needs UDP straight to this host, so this
    must be an address clients can actually route to:

      - same LAN as the server: its local address (e.g. 192.168.1.50)
      - reachable from the internet: the public IP, with this port
        forwarded to the host
      - a VPS: its public IP

    Empty means the SFU advertises the container's private address and
    no browser can connect.
  EOT
  type        = string
  default     = ""
}

variable "sfu_udp_port" {
  description = "Single UDP port carrying all media (ICE mux). Published unmapped, since the port number is baked into the ICE candidates the SFU advertises."
  type        = number
  default     = 7881
}
