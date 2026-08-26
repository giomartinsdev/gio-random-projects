# github.com/Turbootzz/Vaultwarden-API — a small, purpose-built Go
# service that logs into Vaultwarden as a real account (API key +
# master password), syncs and decrypts the vault (Bitwarden's actual
# client-side crypto: PBKDF2/Argon2id + AES-256-CBC-HMAC, not
# something domain-api/domain-worker should reimplement themselves),
# and re-exposes individual items over a trivial internal
# `GET /secret/:name` REST API. Nothing here is reachable outside the
# docker network — no ports{} block. Only
# domain-api/domain-worker (and anything else added later) ever call
# it, over the network by container name.
#
# Pulled from OUR OWN registry, not ghcr.io/turbootzz/vaultwarden-api
# directly: that image's own multi-arch manifest is broken upstream
# (Dockerfile's `ARG TARGETARCH=amd64` never actually gets overridden
# by their CI, so every platform's "variant" -- including the one
# tagged arm64 -- contains the literal same amd64 binary; confirmed by
# reading the raw ELF header, not just a symptom). This is Turbootzz/
# Vaultwarden-API's source built natively (no cross-compilation, no
# QEMU) straight on the VPS's own arm64, then pushed here under the
# same name -- see modules/compute/services/registry's README for
# rebuild instructions when upstream cuts a new release.
resource "docker_container" "vaultwarden_bridge" {
  name    = "vaultwarden-api"
  image   = "${var.registry_host}/vaultwarden-api:${var.bridge_version}"
  restart = "unless-stopped"

  env = [
    "VAULTWARDEN_URL=http://vaultwarden",
    "VAULTWARDEN_EMAIL=${var.vaultwarden_account_email}",
    "VAULTWARDEN_PASSWORD=${var.vaultwarden_account_master_password}",
    "VAULTWARDEN_CLIENT_ID=${var.vaultwarden_api_client_id}",
    "VAULTWARDEN_CLIENT_SECRET=${var.vaultwarden_api_client_secret}",
    # The bearer token domain-api/domain-worker present to THIS
    # service — unrelated to the Vaultwarden account credentials
    # above, which never leave this container.
    "API_KEY=${var.bridge_api_key}",
  ]

  networks_advanced {
    name = var.network_name
  }
}
