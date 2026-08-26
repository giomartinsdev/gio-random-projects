variable "hostname" {
  description = "Public hostname this vault is reachable at — must match locals.tf's service entry for var.published_port. Baked into DOMAIN."
  type        = string
  default     = "vault.giomartins.dev"
}

variable "published_port" {
  description = "Host port the container's internal :80 is published on — what locals.tf's service entry for var.hostname must match."
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

variable "network_name" {
  description = "Docker network (from module.compute_data) to join — lets modules/compute/vaultwarden_bridge reach this container by name (\"vaultwarden\") instead of through the published port."
  type        = string
}
