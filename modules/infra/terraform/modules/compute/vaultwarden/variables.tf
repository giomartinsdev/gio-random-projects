variable "hostname" {
  description = "Public hostname this vault is reachable at — must match the Cloudflare Tunnel ingress rule pointing at var.published_port. Baked into DOMAIN."
  type        = string
  default     = "vault.giomartins.dev"
}

variable "published_port" {
  description = "Host port the container's internal :80 is published on — what the tunnel's ingress rule for var.hostname must point at."
  type        = number
  default     = 8222
}

variable "vaultwarden_version" {
  description = "vaultwarden/server:<version> image tag."
  type        = string
  default     = "latest"
}

variable "admin_token" {
  description = "Token gating /admin. Generate: openssl rand -base64 48."
  type        = string
  sensitive   = true
}
