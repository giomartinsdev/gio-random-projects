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
