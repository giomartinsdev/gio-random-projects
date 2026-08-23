variable "cloudflare_account_id" {
  description = "Cloudflare account ID (dashboard → Account Home → right sidebar)."
  type        = string
}

variable "google_idp_identity_provider_id" {
  description = <<-EOT
    ID of the existing Google identity provider in Zero Trust → Settings
    → Authentication. Not created here — Terraform can't do the Google
    OAuth client ID/secret exchange that provider needs, so it has to
    already exist in the dashboard.
  EOT
  type        = string
}

variable "allowed_emails" {
  description = "Emails allowed to log in via Google SSO to every protected hostname."
  type        = list(string)
  default     = ["giovannidealmeidamartins@gmail.com"]
}

variable "excluded_hostnames" {
  description = <<-EOT
    Hostnames from infra/cloudflared/config.yml that must NOT get a
    Cloudflare Access application — because they authenticate
    themselves (registry's htpasswd, domain-api's X-API-Key) and
    Access's browser-redirect login flow would break any non-browser
    client hitting them (docker login, curl with an API key, etc).
    Every hostname in config.yml is protected by default; list the
    exceptions here, not the other way around.
  EOT
  type    = list(string)
  default = [
    "registry.giomartins.dev",  # docker login/push — own htpasswd auth
    "domain.giomartins.dev",    # REST API clients — own X-API-Key auth
    "minio-api.giomartins.dev", # this project's own Terraform S3 backend — own SigV4 auth
  ]
}

variable "session_duration" {
  description = "How long an Access session stays valid before re-authenticating."
  type        = string
  default     = "24h"
}
