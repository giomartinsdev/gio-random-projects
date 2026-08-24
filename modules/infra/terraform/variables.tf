# --- Cloudflare account/zone ---

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (dashboard → Account Home → right sidebar)."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone ID for giomartins.dev (dashboard → the domain → right sidebar under API)."
  type        = string
}

variable "cloudflare_tunnel_id" {
  description = "ID of the cloudflared tunnel every DNS record points at — see module.cloudflare's own variables.tf for the full explanation."
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

variable "allowed_emails" {
  description = "Emails allowed to log in via Google SSO to every protected hostname."
  type        = list(string)
  default     = ["giovannidealmeidamartins@gmail.com", "workwithgiomartinsdev@gmail.com"]
}

variable "excluded_hostnames" {
  description = <<-EOT
    Hostnames from locals.tf's ingress_rules that must NOT get a
    Cloudflare Access application — see module.cloudflare's own
    variables.tf for the full explanation.
  EOT
  type        = list(string)
  default = [
    "registry.giomartins.dev", # docker login/push — own htpasswd auth + mTLS (modules/cloudflare/registry_mtls.tf); Docker tooling can't do a browser SSO redirect or send custom Access headers
    "domain.giomartins.dev",   # REST API clients — own X-API-Key auth + a service-token Access application (modules/cloudflare/service_token_access.tf)
    "docker.giomartins.dev",   # this config's own docker provider — a service-token Access application (modules/cloudflare/service_token_access.tf)
  ]
}

variable "session_duration" {
  description = "How long a Google SSO Access session stays valid before re-authenticating."
  type        = string
  default     = "24h"
}

# --- docker provider connection ---

variable "docker_host" {
  description = <<-EOT
    Where the docker provider connects — a local header-injecting proxy,
    not docker.giomartins.dev directly (see versions.tf's provider
    "docker" comment). Defaults to the address
    .github/workflows/tf-deploy.yml's sidecar listens on; override for
    local runs.
  EOT
  type        = string
  default     = "tcp://localhost:2475"
}

# --- compute/data + compute/app ---

variable "postgres_password" {
  description = "Password for the domain Postgres user, shared by compute/data and compute/app. Generate: openssl rand -base64 24"
  type        = string
  sensitive   = true
}

variable "domain_api_keys" {
  description = "DOMAIN_API_KEYS value for the api container — comma-separated key:label pairs."
  type        = string
  sensitive   = true
}


# --- compute/registry ---

variable "registry_host" {
  description = "Hostname docker_container/docker_image resources pull images from, and the docker provider's registry_auth is scoped to (versions.tf)."
  type        = string
  default     = "registry.giomartins.dev"
}

variable "registry_user" {
  description = "Basic-auth username for docker push/pull against registry.giomartins.dev."
  type        = string
  default     = "admin"
}

variable "registry_password" {
  description = <<-EOT
    Basic-auth password for the registry. Generate: openssl rand -base64 24.
    Must match the REGISTRY_PASSWORD used for `docker login
    registry.giomartins.dev` on the host (watchtower's pulls depend on
    that login, not on this variable directly) and the REGISTRY_PASSWORD
    secret apps-deploy.yml's push step uses — see
    modules/compute/registry's README.
  EOT
  type        = string
  sensitive   = true
}

# --- compute/monitoring ---

variable "beszel_agent_key" {
  description = "The Beszel hub's SSH public key — see modules/compute/monitoring's own variable of the same name for why this can't have a real default and how to obtain it."
  type        = string
  default     = ""
  sensitive   = true
}

# --- compute/vaultwarden ---

variable "vaultwarden_admin_token" {
  description = "Token gating vault.giomartins.dev/admin. Generate: openssl rand -base64 48."
  type        = string
  sensitive   = true
}
