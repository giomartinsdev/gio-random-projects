# cch-api: the game backend for cch-frontend (cch.giomartins.dev).
# Standalone like tela-api in that it has no database driver of its own
# and no shared auth -- access control is the room password itself --
# but its durable state (room registry, deck marketplace) lives in
# domain-api's cch_rooms/cch_custom_decks tables via the command
# pipeline, not in local files. Host networking for the same reason the
# other websocket backends here use it: nothing to advertise (unlike
# tela's SFU), but it keeps the container's port reachable by the
# host-network ingress without a published-port dance, matching the
# pattern tela-api already set -- and it's what makes the loopback
# DOMAIN_API_URL work.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_volume" "cch_state" {
  name = "cch-state"
}

resource "docker_container" "cch_api" {
  name    = "cch-api"
  image   = "${var.registry_host}/cch-api:latest"
  restart = "unless-stopped"

  # Host networking like tela-api. No SFU here -- nothing needs to
  # advertise an address -- but the app binds BIND_HOST directly and
  # the ingress (compute/services/ingress) reaches it on loopback, so
  # host networking with a loopback bind is the same one-liner the
  # other websocket apps use.
  network_mode = "host"

  env = [
    "PORT=${var.external_port}",
    # The ingress is the only thing meant to reach this directly -- it
    # proxies by Host header to 127.0.0.1:${var.external_port}.
    "BIND_HOST=127.0.0.1",
    "STATE_FILE=/data/rooms.json",
    # Cross-origin caller (cch-frontend's MinIO-served origin) -- see
    # internal/httpapi's AllowedOrigins.
    "FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    # The deck forge's AI writer: 9router runs on this same host
    # (compute/services/ai_proxy), loopback-published on 20128 with
    # REQUIRE_API_KEY=false -- so the loopback call needs no key and no
    # public hop. This container is network_mode=host, so its own
    # localhost IS the VPS's. Model comes from the proxy's own list
    # (internal/ai picks a small one); override with CCH_AI_MODEL if a
    # specific one is wanted.
    "CCH_AI_BASE_URL=http://127.0.0.1:20128/v1",
    # Persistence: rooms and decks go through domain-api's command
    # pipeline (cch_rooms / cch_custom_decks) instead of the JSON files
    # this volume used to hold. Same loopback reasoning as
    # CCH_AI_BASE_URL: host-net container, domain-api publishes
    # 127.0.0.1:8000. Structural writes ride its POST /sync (the
    # documented sync-confirmation exception); play counts the normal
    # async 202. STATE_FILE stays only as the one-time import source
    # for the pre-cutover JSON -- see modules/apps/cch-api/import_legacy.go.
    "DOMAIN_API_URL=${var.domain_api_url}",
    "DOMAIN_API_KEY=${var.domain_api_key}",
  ]

  # Rooms live in memory, but the room registry itself (code, password
  # hash, resume key, knock state -- never the connected peers) is
  # written here so a redeploy doesn't end sessions that are in
  # progress. Same reasoning as tela-state; see
  # modules/apps/cch-api/internal/rooms/store.go.
  volumes {
    volume_name    = docker_volume.cch_state.name
    container_path = "/data"
  }

  dynamic "labels" {
    for_each = local.watchtower_label
    content {
      label = labels.value.label
      value = labels.value.value
    }
  }
}