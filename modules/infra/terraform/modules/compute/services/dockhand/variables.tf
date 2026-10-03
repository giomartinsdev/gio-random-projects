variable "network_name" {
  description = "Docker network to join — reused from compute/data's output, not created here."
  type        = string
}

variable "image_tag" {
  description = <<-EOT
    fnsys/dockhand:<tag>. `latest` is the default so a first apply can
    never dead-end on a tag that no longer exists; the project ships
    roughly weekly, so pin a release (e.g. v1.0.48) if one ever breaks
    the UI and let it ride until the next one.
  EOT
  type        = string
  default     = "latest"
}

variable "published_port" {
  description = "Host loopback port ingress proxies dockhand.giomartins.dev to. Must match the port in root locals.tf's services entry (8093)."
  type        = number
  default     = 8093
}

variable "data_dir" {
  description = "Host path for Dockhand's DATA_DIR (SQLite DB, .encryption_key, git clones), bind-mounted at the same path inside the container (matching paths). Must already exist on the host — a missing dir would be created root-owned by Docker and can't be chowned from Terraform."
  type        = string
  default     = "/opt/dockhand"
}

variable "stacks_dir" {
  description = "Host path for STACKS_DIR (flat layout for local-socket stack files), bind-mounted at the same path inside the container. Must already exist on the host — see data_dir."
  type        = string
  default     = "/opt/stacks"
}
