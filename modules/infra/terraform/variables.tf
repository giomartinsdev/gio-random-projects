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
    "registry.giomartins.dev",      # docker login/push — own htpasswd auth + mTLS (modules/cloudflare/registry_mtls.tf); Docker tooling can't do a browser SSO redirect or send custom Access headers
    "domain.giomartins.dev",        # REST API clients — own X-API-Key auth + a service-token Access application (modules/cloudflare/service_token_access.tf)
    "docker.giomartins.dev",        # this config's own docker provider — a service-token Access application (modules/cloudflare/service_token_access.tf)
    "post-api.giomartins.dev",      # own Better Auth — a browser SSO redirect would break API/bot clients, same reasoning as domain.giomartins.dev
    "bookclub-api.giomartins.dev",  # own Better Auth session check — same reasoning, plus a redirect would break the front's WebSocket upgrade
    "classroom-bdd.giomartins.dev", # meant to be publicly readable by anyone, not gated behind Google SSO
    "ai.giomartins.dev",            # own dashboard login (INITIAL_PASSWORD) + API key auth on /v1 — browser SSO redirect breaks CLI/terminal AI clients
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
# postgres_password and domain_api_keys are Terraform-generated now —
# see secrets.tf — not inputs anymore.

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
    Stays a real input (not Terraform-generated like the other secrets
    in secrets.tf) because the root docker provider (versions.tf) also
    needs it for registry_auth, and provider config can't depend on a
    resource value computed in the same apply. Everything else about
    it IS automated now — see modules/compute/registry's README and
    this config's secrets.tf (docker_config_install/registry_restart/
    vault_seed). apps-deploy.yml's own REGISTRY_PASSWORD GH secret (for
    its push step) is the one thing still synced by hand after a
    rotation.
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
# vaultwarden_admin_token is Terraform-generated now — see secrets.tf.

# --- compute/vaultwarden_bridge ---
# See that module's own README for the required setup order (real
# Vaultwarden account first, then an API key, then these). Only the
# four "secret zero" credentials below stay as real inputs —
# vaultwarden_bridge_api_key is Terraform-generated now (secrets.tf);
# module.compute_vaultwarden_bridge's create/skip guard switched from
# checking that to checking vaultwarden_account_email instead.

variable "vaultwarden_account_email" {
  description = "Email of the real Vaultwarden account modules/compute/vaultwarden_bridge logs in as."
  type        = string
  default     = ""
  sensitive   = true
}

variable "vaultwarden_account_master_password" {
  description = "That account's master password."
  type        = string
  default     = ""
  sensitive   = true
}

variable "vaultwarden_api_client_id" {
  description = "API key client_id from vault.giomartins.dev → Account Settings → Security → Keys."
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

variable "discord_client_id" {
  description = "Discord Application client ID for the classroom-bdd Discord Activity -- blank (the default) leaves the whole feature disabled: post-api's /discord/token route doesn't mount, and front's Activity handshake logs an error and no-ops. Register the app at discord.com/developers/applications, enable Activities, then set this and discord_client_secret."
  type        = string
  default     = ""
}

variable "discord_client_secret" {
  description = "Matching client secret -- see discord_client_id."
  type        = string
  default     = ""
  sensitive   = true
}

