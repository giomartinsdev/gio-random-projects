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

variable "sfu_public_host" {
  description = <<-EOT
    Where browsers should send media -- an IP or a hostname (resolved
    once at startup). Media does NOT go through the Cloudflare tunnel:
    WebRTC is UDP straight to this host, so whatever goes here must
    route to the machine itself.

      - same LAN as the server: its local address, or a name resolving
        to it (e.g. 192.168.1.50)
      - reachable from the internet: a hostname with an UNPROXIED A
        record (grey cloud) pointing at the public IP, with this UDP
        port forwarded to the host
      - a VPS: its public IP, or an unproxied name for it

    NOT tela.giomartins.dev: that's a proxied CNAME to the tunnel and
    resolves to Cloudflare, so media sent there is dropped.

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
