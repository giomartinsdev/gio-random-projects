# Adminer: a single-file, single-container Postgres (and other DB)
# admin GUI. Deliberately carries no database credentials of its own —
# unlike vaultwarden's ADMIN_TOKEN or beszel's own auth, Adminer's
# login page asks for server/user/password/database interactively on
# every visit, so there is nothing DB-related to store in Terraform
# state or bake into this container's env at all. The only thing
# gating access is Cloudflare Access in front of var.hostname (Google
# SSO, same outer layer as beszel/vault/minio — see locals.tf) plus
# whatever real Postgres credentials the person typing them in
# already has (module.storage_postgres's own generated password).
resource "docker_container" "adminer" {
  name    = "adminer"
  image   = "adminer:${var.adminer_version}"
  restart = "unless-stopped"

  ports {
    ip       = "127.0.0.1"
    internal = 8080
    external = var.published_port
  }

  # Same network as the postgres container it's meant to reach by name
  # ("postgres") in its own login form's "Server" field — never a
  # container name bookclub-api/post-api/domain-worker resolve for
  # any purpose, this is purely a human logging in through a browser.
  networks_advanced {
    name = var.network_name
  }
}
