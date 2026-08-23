# The stateful half of the apps stack — postgres and redis, plus the
# network and volumes they need. Separate from compute/app on purpose:
# this is what api/worker (the app module) depend on, never the other
# way around, and it's the part that holds real data — worth being
# able to reason about (and, e.g., add backup tooling to) independently
# of the stateless app containers.
resource "docker_network" "apps" {
  name = var.network_name
}

resource "docker_volume" "postgres_data" {
  name = "apps_postgres_data"
}

resource "docker_volume" "redis_data" {
  name = "apps_redis_data"
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
    name = docker_network.apps.name
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

resource "docker_container" "redis" {
  name    = "redis"
  image   = var.redis_image
  restart = "unless-stopped"

  networks_advanced {
    name = docker_network.apps.name
  }

  mounts {
    type   = "volume"
    source = docker_volume.redis_data.name
    target = "/data"
  }

  healthcheck {
    test     = ["CMD", "redis-cli", "ping"]
    interval = "5s"
    timeout  = "5s"
    retries  = 10
  }
}
