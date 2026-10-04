# Variáveis que sobraram depois da migração: só o que a Cloudflare, a rede
# `apps` e o baseline do host precisam. Tudo de storage/compute/apps virou
# stack (Dockhand) e não é mais input do Terraform.

# --- Cloudflare account/zone ---

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (dashboard → Account Home → right sidebar)."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone ID for giomartins.dev (dashboard → the domain → right sidebar under API)."
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

variable "allowed_emails" {
  description = "Emails allowed to log in via Google SSO to every protected hostname."
  type        = list(string)
  default     = ["giovannidealmeidamartins@gmail.com", "workwithgiomartinsdev@gmail.com"]
}

variable "excluded_hostnames" {
  description = <<-EOT
    Hostnames from locals.tf that must NOT get a Cloudflare Access
    application once the records go proxied — see module.cloudflare's
    own variables.tf for the full explanation.
  EOT
  type        = list(string)
  default = [
    "registry.giomartins.dev",  # docker login/push — own htpasswd auth + mTLS (modules/cloudflare/registry_mtls.tf); Docker tooling can't do a browser SSO redirect or send custom Access headers
    "domain.giomartins.dev",    # REST API clients — own X-API-Key auth + a service-token Access application (modules/cloudflare/service_token_access.tf)
    "tela.giomartins.dev",      # rooms are shared with people who have no account here; the room password is the access control
    "tela-api.giomartins.dev",  # same tela-frontend page calls this cross-origin for signalling/SFU — a browser SSO redirect would break every fetch/WebSocket call
    "hub.giomartins.dev",       # the hub is chrome around the public SPAs, so it's public too — its opt-in Google login lives on the /sso path instead (see path_protected_hostnames in locals.tf), which gates only the admin shortcuts tier
    "clubs.giomartins.dev",     # the hub's SPA is public by design -- a visitor reads the whole dataset with no account, and it must be iframe-embeddable in the hub (same reasoning as tela); the opt-in login is clubs-api's own Google Sign-In, no Access app involved
    "clubs-api.giomartins.dev", # no Cloudflare Access at all -- its own Google Sign-In + session cookie is the gate (see stacks/clubs.yml); the bare hostname serves the public reads so an anonymous visitor can browse and the SPA can probe /api/me without a redirect
    "ai.giomartins.dev",        # own dashboard login (INITIAL_PASSWORD) + API key auth on /v1 — browser SSO redirect breaks CLI/terminal AI clients
    "otel.giomartins.dev",      # public visitors' browsers send SPA telemetry here — a Google SSO redirect would break every one of them; alloy's OTLP receiver CORS allowlist (the SPA origins only) is the access control (stacks/observability.yml)
    "maus.giomartins.dev",      # only the DNS record lives in Terraform (the OpenMausBot stack is a Dockhand git stack, like the other apps); no Access app — OpenMausBot's own pairing login is the gate, and its SSE chat must not sit behind a browser SSO redirect
    "finance-webhook.giomartins.dev", # webhook do WhatsApp (Meta) entregue ao finance-whatsapp-worker -- a Meta nao passa por um redirect de SSO Google; a defesa e a assinatura X-Hub-Signature-256 + verificacao de origem (ver stacks/finance.yml e §10.5)
  ]
}

variable "session_duration" {
  description = "How long a Google SSO Access session stays valid before re-authenticating."
  type        = string
  default     = "24h"
}

variable "email_routing_destination" {
  description = "Gmail mailbox everything Cloudflare Email Routing forwards to (see modules/cloud/cloudflare/email_routing.tf) — also the identity Gmail's Send-mail-as uses. One-time manual step after apply: click Cloudflare's verification email, or the rules stay inert."
  type        = string
  default     = "giovannidealmeidamartins@gmail.com"
}

variable "email_routing_rules" {
  description = "Custom addresses on the domain as local part → destination mailbox (each destination must have its Cloudflare verification email clicked before its rule activates)."
  type        = map(string)
  default = {
    gio     = "giovannidealmeidamartins@gmail.com"
    contact = "workwithgiomartinsdev@gmail.com"
  }
}

# --- server ---

variable "server_ip" {
  description = "Public IP of the VPS. Target of every DNS A record (dns.tf)."
  type        = string
}

variable "host_interface" {
  description = "The VPS's primary network interface, whose MTU the host baseline pins. Empty skips the MTU step."
  type        = string
  default     = "enp0s6"
}

variable "host_mtu" {
  description = "MTU to pin on host_interface. 1500 (standard Ethernet) is correct for a host on the public internet; Oracle images sometimes ship 9000 (jumbo), which silently drops large packets on the internet path."
  type        = number
  default     = 1500
}

# --- docker provider connection ---

variable "docker_host" {
  description = <<-EOT
    Where the docker provider connects — straight to the VPS dockerd
    over SSH, same channel a human `docker` CLI would use. Requires the
    key in the caller's ssh-agent (CI: tf-ci-cd.yml's SSH setup step;
    locally: your own agent). No default — always ssh://ubuntu@<server_ip>,
    and hardcoding that IP twice invites the two to drift.
  EOT
  type        = string
}
