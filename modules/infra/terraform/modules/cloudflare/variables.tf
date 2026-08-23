variable "account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "zone_id" {
  description = "Zone ID for the domain DNS records are created in."
  type        = string
}

variable "tunnel_name" {
  description = "Name of the existing cloudflared tunnel (imported, not created — see tunnel.tf)."
  type        = string
  default     = "gio-server"
}

variable "tunnel_id" {
  description = <<-EOT
    ID of the existing cloudflared tunnel every DNS record points at.
    Also the default for modules/infra/terraform-bootstrap's own
    tunnel_id variable — that's what makes the actual cloudflared
    process on gio-server present itself as this tunnel; this variable
    only needs the ID to build each CNAME's target and to import the
    resource into state.
  EOT
  type        = string
  default     = "36f8270d-52a2-4635-b9f2-f5174307e76e"
}

variable "google_idp_identity_provider_id" {
  description = <<-EOT
    ID of the existing Google identity provider in Zero Trust →
    Settings → Authentication. Not created here — Terraform can't do
    the Google OAuth client ID/secret exchange that provider needs, so
    it has to already exist in the dashboard.
  EOT
  type        = string
}

variable "ingress_rules" {
  description = "Every hostname/service pair this homelab exposes — see the root module's locals.tf, the single source of truth this and the compute modules both derive from."
  type = list(object({
    hostname = string
    service  = string
  }))
}

variable "excluded_hostnames" {
  description = <<-EOT
    Hostnames from var.ingress_rules that must NOT get a Cloudflare
    Access application — because they authenticate themselves
    (registry's htpasswd, domain-api's X-API-Key, docker.giomartins.dev's
    own service-token policy) and Access's browser-redirect login flow
    would break any non-browser client hitting them. Every hostname in
    var.ingress_rules is protected by default; list the exceptions
    here, not the other way around.
  EOT
  type        = list(string)
  default     = []
}

variable "allowed_emails" {
  description = "Emails allowed to log in via Google SSO to every protected hostname."
  type        = list(string)
}

variable "session_duration" {
  description = "How long a Google SSO Access session stays valid before re-authenticating."
  type        = string
  default     = "24h"
}
