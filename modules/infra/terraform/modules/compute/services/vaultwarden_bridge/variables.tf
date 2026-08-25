variable "network_name" {
  description = "Docker network (from module.compute_data) to join — must be the same one module.compute_vaultwarden's container is on, and the one domain-api/domain-worker are on."
  type        = string
}

variable "bridge_version" {
  description = "ghcr.io/turbootzz/vaultwarden-api:<version> image tag."
  type        = string
  default     = "latest"
}

variable "vaultwarden_account_email" {
  description = "Email of the real Vaultwarden account this bridge logs in as — the one you create yourself through vault.giomartins.dev's signup form. Not something Terraform can generate; the account has to exist first."
  type        = string
  sensitive   = true
}

variable "vaultwarden_account_master_password" {
  description = "That account's master password — the one you chose when creating it. Needed because Bitwarden's end-to-end encryption means decrypting vault items requires this regardless of any API key."
  type        = string
  sensitive   = true
}

variable "vaultwarden_api_client_id" {
  description = "API key client_id from vault.giomartins.dev → Account Settings → Security → Keys. Optional but avoids 2FA friction on every bridge restart."
  type        = string
  default     = ""
  sensitive   = true
}

variable "vaultwarden_api_client_secret" {
  description = "Matching client_secret for vaultwarden_api_client_id."
  type        = string
  default     = ""
  sensitive   = true
}

variable "bridge_api_key" {
  description = "Bearer token domain-api/domain-worker present to this bridge (unrelated to the Vaultwarden account credentials above). Generate: openssl rand -base64 32."
  type        = string
  sensitive   = true
}
