variable "cloudflare_account_id" {
  description = "Cloudflare account ID (dashboard → Account Home → right sidebar)."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone ID for giomartins.dev (dashboard → the domain → right sidebar under API)."
  type        = string
}

variable "cloudflare_tunnel_id" {
  description = <<-EOT
    ID of the cloudflared tunnel every DNS record points at (also
    hardcoded in modules/infra/cloudflared/config.yml's `tunnel:` field — that
    file still owns the tunnel's ingress routing, this only needs the
    ID to build each CNAME's target).
  EOT
  type    = string
  default = "36f8270d-52a2-4635-b9f2-f5174307e76e"
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
    Hostnames from modules/infra/cloudflared/config.yml that must NOT get a
    Cloudflare Access application — because they authenticate
    themselves (registry's htpasswd, domain-api's X-API-Key) and
    Access's browser-redirect login flow would break any non-browser
    client hitting them (docker login, curl with an API key, etc).
    Every hostname in config.yml is protected by default; list the
    exceptions here, not the other way around.
  EOT
  type    = list(string)
  default = [
    "registry.giomartins.dev", # docker login/push — own htpasswd auth
    "domain.giomartins.dev",   # REST API clients — own X-API-Key auth
    "docker.giomartins.dev",   # Terraform's own docker provider — own Access service-token policy, see docker.tf
  ]
}

variable "session_duration" {
  description = "How long an Access session stays valid before re-authenticating."
  type        = string
  default     = "24h"
}

variable "docker_host" {
  description = <<-EOT
    Where the docker provider connects — a local header-injecting proxy
    (see versions.tf's provider "docker" comment), not
    docker.giomartins.dev directly. Defaults to the address
    .github/workflows/tf-deploy.yml's sidecar listens on; override for
    local runs (compute.tf's README documents the equivalent local
    sidecar setup).
  EOT
  type    = string
  default = "tcp://localhost:2475"
}

variable "postgres_password" {
  description = "Password for the domain Postgres user. Generate: openssl rand -base64 24"
  type        = string
  sensitive   = true
}

variable "domain_api_keys" {
  description = "DOMAIN_API_KEYS value for the api container — comma-separated key:label pairs."
  type        = string
  sensitive   = true
}
