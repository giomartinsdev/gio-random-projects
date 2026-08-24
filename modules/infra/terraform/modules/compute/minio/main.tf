# Object storage for bookclub-api's uploaded PDFs -- replaces the
# bytea-in-Postgres approach (see bookclub-api's own db/schema.ts
# history) now that the PDFs are the one kind of data in this repo
# that's actually a good fit for an object store rather than a
# relational table.
#
# Internal-only, same shape as modules/compute/vaultwarden_bridge: no
# ports{} block, no tunnel ingress rule, no DNS record -- only
# containers on network_name can reach it, by name ("minio", port
# 9000). bookclub-api is the only caller; nothing here is meant to be
# reachable from a browser directly (no presigned-URL flow, no public
# bucket -- bookclub-api proxies the bytes through its own
# already-authenticated /rooms/:id/pdf route, same as before).
resource "docker_volume" "minio_data" {
  name = "apps_minio_data"
}

resource "docker_container" "minio" {
  name    = "minio"
  image   = "minio/minio:latest"
  restart = "unless-stopped"
  command = ["server", "/data"]

  env = [
    "MINIO_ROOT_USER=${var.root_user}",
    "MINIO_ROOT_PASSWORD=${var.root_password}",
  ]

  networks_advanced {
    name = var.network_name
  }

  mounts {
    type   = "volume"
    source = docker_volume.minio_data.name
    target = "/data"
  }

  healthcheck {
    test     = ["CMD", "mc", "ready", "local"]
    interval = "5s"
    timeout  = "5s"
    retries  = 5
  }
}
