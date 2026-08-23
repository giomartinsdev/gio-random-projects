# postgres, redis, api, and worker as real docker_container resources
# instead of docker-compose — `terraform apply` creates/repairs all of
# them the same way it already does DNS/Access/tunnel. modules/infra/watchtower
# still handles automatic redeploys when apps-deploy.yml pushes a new
# :latest — this is what defines the containers exist with the right
# image/env/network/volumes in the first place, and repairs drift if
# any of them get removed by hand.
#
# All four share one bridge network (name resolution: "postgres",
# "redis" as hostnames — same as the docker-compose setup they
# replace) and connect through the header-injecting proxy documented
# in versions.tf's provider "docker" block, not docker.giomartins.dev
# directly.

resource "docker_network" "apps" {
  name = "apps"
}

resource "docker_volume" "postgres_data" {
  name = "apps_postgres_data"
}

resource "docker_volume" "redis_data" {
  name = "apps_redis_data"
}

resource "docker_container" "postgres" {
  name    = "postgres"
  image   = "postgres:17-alpine"
  restart = "unless-stopped"

  env = [
    "POSTGRES_USER=domain",
    "POSTGRES_PASSWORD=${var.postgres_password}",
    "POSTGRES_DB=domain",
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
    test     = ["CMD-SHELL", "pg_isready -U domain"]
    interval = "5s"
    timeout  = "5s"
    retries  = 10
  }
}

resource "docker_container" "redis" {
  name    = "redis"
  image   = "redis:7-alpine"
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

resource "docker_container" "api" {
  name    = "api"
  image   = "registry.giomartins.dev/api:latest"
  restart = "unless-stopped"

  env = [
    "DATABASE_URL=postgresql://domain:${var.postgres_password}@postgres:5432/domain",
    "REDIS_ADDR=redis:6379",
    "HTTP_ADDR=:8000",
    "DOMAIN_API_KEYS=${var.domain_api_keys}",
    "RATE_LIMIT_RPS=1",
    "RATE_LIMIT_BURST=5",
  ]

  ports {
    internal = 8000
    external = 8000
  }

  networks_advanced {
    name = docker_network.apps.name
  }

  # The only thing that lets modules/infra/watchtower keep pulling and
  # redeploying this on its own after CI pushes a new :latest.
  labels {
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }

  depends_on = [docker_container.postgres, docker_container.redis]
}

resource "docker_container" "worker" {
  name    = "worker"
  image   = "registry.giomartins.dev/worker:latest"
  restart = "unless-stopped"

  env = [
    "DATABASE_URL=postgresql://domain:${var.postgres_password}@postgres:5432/domain",
    "REDIS_ADDR=redis:6379",
  ]

  networks_advanced {
    name = docker_network.apps.name
  }

  labels {
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }

  depends_on = [docker_container.postgres, docker_container.redis]
}
