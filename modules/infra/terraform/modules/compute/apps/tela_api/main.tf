# tela-api: the signalling backend for tela-frontend
# (tela.giomartins.dev). Screen-share media is proxied through a
# self-hosted MediaMTX (WHIP to publish, WHEP to read): this container
# only relays the SDP, the browser exchanges media directly with
# MediaMTX's ICE/DTLS port. See modules/apps/tela-api/internal/mediamtx.
#
# Neither app shares anything with the rest of this repo -- no Postgres,
# no Better Auth, no domain-api.
locals {
  watchtower_label = var.watchtower_enabled ? [{
    label = "com.centurylinklabs.watchtower.enable"
    value = "true"
  }] : []
}

resource "docker_volume" "tela_state" {
  name = "tela-state"
}

# MediaMTX: the WebRTC SFU the browsers publish to and read from. Host
# networking, same as tela-api below, for the same reason -- it must
# advertise an address browsers can reach, and it binds the media port
# directly (no port mapping, since the port number is baked into the ICE
# candidates it advertises). Config is passed as MTX_* env vars so no
# file has to already exist on the host.
resource "docker_container" "mediamtx" {
  name    = "tela-mediamtx"
  image   = "bluenviron/mediamtx:1"
  restart = "unless-stopped"

  network_mode = "host"

  env = [
    # HTTP side of WHIP/WHEP. tela-api reaches it over the host's
    # loopback (both are host-networked, so docker DNS doesn't exist).
    "MTX_WEBRTCADDRESS=127.0.0.1:8889",
    # The single UDP/TCP port browsers connect to for ICE/DTLS. It has to
    # be reachable from the internet and must match what browsers are
    # told, so it binds unmapped on the host.
    "MTX_WEBRTCLOCALUDPADDRESS=:${var.mediamtx_udp_port}",
    "MTX_WEBRTCLOCALTCPADDRESS=:${var.mediamtx_udp_port}",
    # The address MediaMTX advertises in its ICE candidates. Empty leaves
    # it advertising container/host-internal addresses no browser can
    # reach, which shows up only as video that never starts.
    "MTX_WEBRTCADDITIONALHOSTS=${var.mediamtx_public_host}",
    # CRITICAL: without this MediaMTX ALSO advertises every interface
    # address it can see -- the host's private 10.0.0.209, docker0's
    # 172.17.0.1, br-*'s 172.18.0.1. Chrome then picks one of those from
    # the SDP, sends its ICE checks to an address that isn't routable from
    # the internet, and the handshake never completes (ICE "succeeds" on
    # the public candidate but DTLS hangs on the unreachable one). With
    # this off, the only candidate is MTX_WEBRTCADDITIONALHOSTS -- the
    # public IP.
    "MTX_WEBRTCIPSFROMINTERFACES=no",
    # Nothing else MediaMTX can speak is used -- WebRTC only. (MoQ
    # otherwise binds :8892 by default in MediaMTX 1.x.)
    "MTX_RTSP=no",
    "MTX_RTMP=no",
    "MTX_HLS=no",
    "MTX_SRT=no",
    "MTX_MOQ=no",
    "MTX_API=no",
    "MTX_METRICS=no",
    "MTX_LOGLEVEL=info",
    "MTX_LOGDESTINATIONS=stdout",
    # No `paths` block: one path per publisher is created on demand
    # (see mediamtx.PathFor).
  ]

  dynamic "labels" {
    for_each = local.watchtower_label
    content {
      label = labels.value.label
      value = labels.value.value
    }
  }
}

resource "docker_container" "tela_api" {
  name    = "tela-api"
  image   = "${var.registry_host}/tela-api:latest"
  restart = "unless-stopped"

  # Host networking, unlike most apps here. tela-api proxies MediaMTX's
  # SDP over loopback and MediaMTX binds the media port directly, so
  # both need the host's network namespace -- and no port mapping: the
  # app binds var.external_port directly (the HTTP side), and MediaMTX's
  # UDP/TCP media port binds unmapped on the host.
  network_mode = "host"

  env = [
    "PORT=${var.external_port}",
    # The ingress (compute/services/ingress) is the only thing meant to
    # reach the HTTP side directly -- it runs on the host network too
    # and proxies by Host header to 127.0.0.1:${var.external_port}.
    # The media port above is unaffected: it has to stay reachable from
    # the internet directly, since it's WebRTC media, not HTTP.
    "BIND_HOST=127.0.0.1",
    "STATE_FILE=/data/rooms.json",
    # MediaMTX over the host's loopback (both containers are
    # host-networked, so the docker-network name `mediamtx` doesn't
    # resolve). Empty disables screen sharing entirely.
    "MEDIAMTX_INTERNAL_URL=http://127.0.0.1:8889",
    # ICE for the browser. STUN-only by default (empty = unset): the
    # direct path to MediaMTX is healthy most of the time. A TURN relay
    # is the fallback for a path that can't carry media (a hostile
    # network, or one that drops the large DTLS handshake packets);
    # because MediaMTX has a public IP, only the browser side needs the
    # relay, so a managed TURN (Cloudflare) is enough. All secrets come
    # from the vault via TF_VAR_*, never the repo.
    "TELA_STUN_URLS=${var.stun_urls}",
    "TELA_TURN_URLS=${var.turn_urls}",
    "TELA_TURN_USERNAME=${var.turn_username}",
    "TELA_TURN_PASSWORD=${var.turn_password}",
    "TELA_TURN_CF_KEY_ID=${var.turn_cf_key_id}",
    "TELA_TURN_CF_API_TOKEN=${var.turn_cf_api_token}",
    # Now a cross-origin caller (tela-frontend's own hostname/container)
    # instead of same-origin -- see internal/httpapi's AllowedOrigins.
    "FRONTEND_ORIGINS=${join(",", var.frontend_origins)}",
    # Loopback, not http://alloy:4318: host networking means docker DNS
    # doesn't exist here -- alloy's 4318 is published on 127.0.0.1 for
    # ingress, and this container shares the host's loopback. Traces +
    # metrics only -- logs flow via alloy's docker-socket scrape of
    # stdout (see otlp_endpoint's description).
    "OTEL_EXPORTER_OTLP_ENDPOINT=${var.otlp_endpoint}",
    "OTEL_SERVICE_NAME=tela-api",
  ]

  # Rooms live in memory, but the room registry itself (code, password
  # hash, resume key -- never the connected peers) is written here so a
  # redeploy doesn't end sessions that are in progress. Without it, a
  # deploy while people are sharing drops every room and they can't even
  # rejoin. See modules/apps/tela-api/internal/rooms/store.go.
  volumes {
    volume_name    = docker_volume.tela_state.name
    container_path = "/data"
  }

  # The HTTP side answers immediately; MediaMTX may still be starting, but
  # that only affects a share, not the room, so a soft dependency is
  # enough (and a hard one would restart tela-api whenever MediaMTX
  # changed). Ordering just keeps `terraform apply` readable.
  depends_on = [docker_container.mediamtx]

  dynamic "labels" {
    for_each = local.watchtower_label
    content {
      label = labels.value.label
      value = labels.value.value
    }
  }
}
