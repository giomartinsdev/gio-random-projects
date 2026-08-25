resource "docker_volume" "redis_data" {
  name = "apps_redis_data"
}

resource "docker_container" "redis" {
  name    = "redis"
  image   = var.redis_image
  restart = "unless-stopped"

  networks_advanced {
    name = var.network_name
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
