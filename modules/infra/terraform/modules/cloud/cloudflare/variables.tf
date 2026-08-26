variable "account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "zone_id" {
  description = "Zone ID for the domain DNS records are created in."
  type        = string
}

variable "server_ip" {
  description = <<-EOT
    Public IP of the VPS every DNS record resolves to. Grey-cloud
    records until the proxy flip; the same IP is what Cloudflare
    connects to once they're orange.
  EOT
  type        = string
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

variable "hostnames" {
  description = "Every hostname this homelab exposes — see the root module's locals.tf, the single source of truth."
  type        = list(string)
}

variable "excluded_hostnames" {
  description = <<-EOT
    Hostnames from var.hostnames that must NOT get the Google-SSO
    Cloudflare Access application access.tf sets up — because Access's
    browser-redirect login flow would break any non-browser client
    hitting them. Every one still gets a second auth layer, just not
    that one: domain.giomartins.dev gets its own non-interactive
    service-token Access application instead (see
    service_token_access.tf — no redirect, just two static headers any
    HTTP client can send), and registry.giomartins.dev gets mTLS
    instead of an Access application at all (see registry_mtls.tf —
    Docker's push/pull tooling can't send custom headers either, so
    even a service token wouldn't work there). Every hostname in
    var.hostnames is protected by default; list the exceptions here,
    not the other way around.
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
