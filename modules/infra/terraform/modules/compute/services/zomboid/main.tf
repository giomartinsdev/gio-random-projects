# Zomboid: a dedicated Project Zomboid co-op game server. The one
# service here that is NOT browser-facing HTTP — it speaks Steam's UDP
# protocols, so the whole locals.tf → Cloudflare DNS/Access → ingress
# pipeline doesn't apply: no hostname entry (nothing for nginx to
# route), no loopback-only binding. Players point the game client
# straight at the VPS IP, the same way tela's WebRTC UDP port is
# directly internet-reachable (see modules/compute/apps/tela/main.tf).
#
# Nothing internal talks to this container either, so unlike most
# services here it doesn't even join the shared `apps` docker network.

resource "docker_volume" "zomboid_data" {
  name = "zomboid_data"
}

resource "docker_volume" "zomboid_config" {
  name = "zomboid_config"
}

resource "docker_container" "zomboid" {
  name    = "zomboid-server"
  image   = "sknnr/project-zomboid-server:${var.image_version}"
  restart = "unless-stopped"

  env = [
    "SERVER_NAME=${var.server_name}",
    # Join password and admin credentials are Terraform-generated (root
    # secrets.tf) and seeded into Vaultwarden like every other secret.
    "SERVER_PASSWORD=${var.server_password}",
    "ADMIN_USERNAME=${var.admin_username}",
    "ADMIN_PASSWORD=${var.admin_password}",
    "MAX_PLAYERS=${var.max_players}",
  ]

  # Deliberately published on ALL interfaces, breaking the
  # loopback-only rule every HTTP service follows: game traffic is
  # UDP and ingress (nginx) carries HTTP only, so there is no proxy
  # path — these must open straight onto the host's public interface.
  # The VPS firewall (ufw) has to allow them; nothing in this repo
  # manages that today.
  ports {
    internal = 16261
    external = 16261
    protocol = "udp" # Steam authentication/query port
  }

  ports {
    internal = 16262
    external = 16262
    protocol = "udp" # Game/co-op traffic
  }

  ports {
    internal = 27015
    external = 27015
    protocol = "tcp" # Source engine query — server-list pings
  }

  mounts {
    type   = "volume"
    source = docker_volume.zomboid_data.name
    target = "/home/steam/ZomboidDedicatedServer"
  }

  mounts {
    type   = "volume"
    source = docker_volume.zomboid_config.name
    target = "/home/steam/Zomboid"
  }
}
