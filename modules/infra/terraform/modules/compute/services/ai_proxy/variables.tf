variable "network_name" {
  description = "Docker network to join — reused from compute/data's output so 9router can reach other services by container name."
  type        = string
}

variable "hostname" {
  description = "Public hostname 9router is reachable at (used to set BASE_URL so internal sync jobs resolve correctly)."
  type        = string
}

variable "jwt_secret" {
  description = "Secret used to sign 9router session JWTs. Terraform-generated in secrets.tf."
  type        = string
  sensitive   = true
}

variable "initial_password" {
  description = "Dashboard login password set on first boot. Terraform-generated in secrets.tf. Change it through the dashboard after first login."
  type        = string
  sensitive   = true
}

variable "image_tag" {
  description = "ghcr.io/decolua/9router:<tag> to deploy."
  type        = string
  default     = "latest"
}
