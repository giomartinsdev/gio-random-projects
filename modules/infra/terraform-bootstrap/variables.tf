variable "cloudflare_account_id" {
  description = "Cloudflare account ID (dashboard → Account Home → right sidebar)."
  type        = string
}

variable "cloudflare_user_id" {
  description = "Cloudflare user ID (GET https://api.cloudflare.com/client/v4/user, .result.id) — scopes cloudflare_api_token.bootstrap's own \"API Tokens Read\" policy, see token.tf."
  type        = string
}

variable "docker_host" {
  description = <<-EOT
    Where the docker provider connects. Must be an SSH port-forward to
    dockerd's TCP listener (127.0.0.1:2376 on gio-server, see
    docker.service.d/override.conf) run by hand ahead of time — see
    README.md. Never docker.giomartins.dev; that would put this config
    back on the tunnel it exists to manage independently of.
  EOT
  type        = string
  default     = "tcp://localhost:2376"
}

variable "tunnel_id" {
  description = "ID of the cloudflared tunnel this container presents itself as — see modules/infra/terraform/modules/cloudflare's own variable of the same name for the full explanation."
  type        = string
  default     = "36f8270d-52a2-4635-b9f2-f5174307e76e"
}

variable "cloudflared_image_tag" {
  description = "cloudflare/cloudflared:<tag>."
  type        = string
  default     = "latest"
}

variable "creds_file_path" {
  description = "Path to the tunnel's credentials JSON, on gio-server's own filesystem (not the machine running terraform) — dockerd resolves bind-mount sources against its own host."
  type        = string
  default     = "/home/gioserver/gio-random-projects/modules/infra/terraform-bootstrap/creds.json"
}
