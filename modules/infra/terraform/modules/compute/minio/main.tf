# Object storage for bookclub-api's uploaded PDFs -- replaces the
# bytea-in-Postgres approach (see bookclub-api's own db/schema.ts
# history) now that the PDFs are the one kind of data in this repo
# that's actually a good fit for an object store rather than a
# relational table.
#
# API port (9000): internal-only, no tunnel -- only containers on
# network_name reach it by name ("minio:9000"). bookclub-api proxies
# bytes through its own authenticated route; no presigned-URL flow.
#
# Console port (9001): published to localhost and tunnelled via
# minio.giomartins.dev. Gated by Cloudflare Access Google SSO
# (same as beszel/vault) as the outer auth layer; MinIO's own
# root-credentials login is the inner one.
resource "docker_volume" "minio_data" {
  name = "apps_minio_data"
}

resource "docker_container" "minio" {
  name  = "minio"
  image = "minio/minio:latest"

  restart = "unless-stopped"

  # --console-address pins the console to a fixed port so the
  # Cloudflare tunnel ingress rule always points at the right place.
  # Without it, MinIO picks a random ephemeral port on each restart.
  command = ["server", "/data", "--console-address", ":9001"]

  env = [
    "MINIO_ROOT_USER=${var.root_user}",
    "MINIO_ROOT_PASSWORD=${var.root_password}",
    # Explicit — MinIO defaults to on, but being explicit avoids
    # surprises if a future image flips the default.
    "MINIO_BROWSER=on",
  ]

  # Console UI — published so the Cloudflare tunnel on the host can
  # reach it. The API port (9000) stays unpublished: only containers
  # on the shared network need it.
  ports {
    internal = 9001
    external = 9001
  }

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
