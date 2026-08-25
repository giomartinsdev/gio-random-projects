# Vaultwarden: an unofficial, single-container Bitwarden-compatible
# server. Speaks the real Bitwarden API (works with the official
# browser extensions/apps) and ships the full Bitwarden web vault GUI
# itself — no separate frontend container needed, unlike the official
# multi-service Bitwarden self-host stack this homelab has no reason
# to run for one user.

resource "docker_volume" "vaultwarden_data" {
  name = "vaultwarden_data"
}

resource "docker_container" "vaultwarden" {
  name    = "vaultwarden"
  image   = "vaultwarden/server:${var.vaultwarden_version}"
  restart = "unless-stopped"

  env = [
    # Must match the externally-visible URL exactly — Vaultwarden
    # embeds this in WebAuthn challenges and icon-fetch requests; a
    # mismatch breaks passkey login silently.
    "DOMAIN=https://${var.hostname}",
    # Cloudflare Access already gates who can reach this hostname at
    # all (Google SSO, allowed_emails) before Vaultwarden's own login
    # ever loads, so leaving self-signup open behind that doesn't
    # widen who can actually get in — only var.allowed_emails can.
    "SIGNUPS_ALLOWED=true",
    "WEBSOCKET_ENABLED=true",
    # Gates /admin (user management, org config, diagnostics) —
    # separate from any individual user's master password. Plaintext
    # here, like registry_password elsewhere in this repo; Terraform
    # state is the sensitive artifact to protect either way.
    "ADMIN_TOKEN=${var.admin_token}",
  ]

  ports {
    internal = 80
    external = var.published_port
  }

  # Also reachable by container name ("vaultwarden") on the internal
  # apps network — modules/compute/vaultwarden_bridge's own container
  # talks to it this way, not through the published port/tunnel.
  networks_advanced {
    name = var.network_name
  }

  mounts {
    type   = "volume"
    source = docker_volume.vaultwarden_data.name
    target = "/data"
  }
}
