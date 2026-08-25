resource "docker_volume" "postgres_data" {
  name = "apps_postgres_data"
}

resource "docker_container" "postgres" {
  name    = "postgres"
  image   = var.postgres_image
  restart = "unless-stopped"

  env = [
    "POSTGRES_USER=${var.postgres_user}",
    "POSTGRES_PASSWORD=${var.postgres_password}",
    "POSTGRES_DB=${var.postgres_user}",
  ]

  networks_advanced {
    name = var.network_name
  }

  mounts {
    type   = "volume"
    source = docker_volume.postgres_data.name
    target = "/var/lib/postgresql/data"
  }

  healthcheck {
    test     = ["CMD-SHELL", "pg_isready -U ${var.postgres_user}"]
    interval = "5s"
    timeout  = "5s"
    retries  = 10
  }
}
