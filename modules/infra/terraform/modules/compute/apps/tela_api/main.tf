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
    #
    # When a coturn runs on the same host it needs the PRIVATE address
    # too: the relay can't reach the host's own public IP (Oracle doesn't
    # hairpin), but it can reach the private one directly. So both are
    # advertised; the browser uses whichever path works.
    "MTX_WEBRTCADDITIONALHOSTS=${trimspace("${var.mediamtx_public_host} ${var.mediamtx_private_host}")}",
    # CRITICAL: without this MediaMTX ALSO advertises every interface
    # address it can see -- docker0's 172.17.0.1, br-*'s 172.18.0.1, etc.
    # A browser can pick one of those from the SDP, send its ICE checks to
    # an address that isn't routable from the internet, and the handshake
    # never completes. With this off, the only candidates are the ones
    # named in MTX_WEBRTCADDITIONALHOSTS above.
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

# coturn: the free TURN relay. It runs on the same host as MediaMTX, so
# it must also have host networking (its relay allocations bind the host's
# interface, and its advertised external-ip must be the host's public one).
# Auth is `static-auth-secret`: tela-api mints time-limited credentials
# that coturn verifies against the same secret -- no fixed password, no
# open relay. Off by default (count = var.coturn_enabled ? 1 : 0).
resource "docker_container" "coturn" {
  count   = var.coturn_enabled ? 1 : 0
  name    = "tela-coturn"
  image   = "coturn/coturn:latest"
  restart = "unless-stopped"

  network_mode = "host"

  # `--external-ip=PUBLIC/PRIVATE`: coturn tells peers to reach its relay
  # on the PUBLIC address, while internally it uses the PRIVATE one -- the
  # exact shape a host that can't hairpin to its own public IP needs.
  # `--listening-ip`/`--relay-ip` pin it to the VCN private interface so
  # it never wanders onto docker0/br-* addresses. `--use-auth-secret`
  # makes every credential short-lived (minted by tela-api); `--no-cli`
  # and `--no-tls` keep the surface minimal (plain UDP/TCP only -- the
  # browser's TURN transport on 3478).
  command = [
    "-n",
    "--use-auth-secret",
    "--static-auth-secret=${random_password.tela_turn_secret.result}",
    "--realm=tela.giomartins.dev",
    "--no-cli",
    "--no-tls",
    "--log-file=stdout",
    "--fingerprint",
    "--listening-ip=${var.mediamtx_private_host}",
    "--relay-ip=${var.mediamtx_private_host}",
    "--listening-port=${var.coturn_listen_port}",
    "--min-port=${var.coturn_relay_min_port}",
    "--max-port=${var.coturn_relay_max_port}",
    "--external-ip=${var.coturn_public_host}/${var.mediamtx_private_host}",
  ]

  depends_on = [docker_container.mediamtx]

  dynamic "labels" {
    for_each = local.watchtower_label
    content {
      label = labels.value.label
      value = labels.value.value
    }
  }
}

# Hairpin NAT: MediaMTX and coturn share a host, and Oracle doesn't route
# a host back to its own public IP. When a viewer uses the relay, MediaMTX
# must send media to the relay's PUBLIC address -- which, from the host,
# would otherwise leave and never come back. The rule redirects the host's
# own outbound UDP to its public IP back onto the private interface (DNAT)
# and source-NATs it so replies return. Scoped to the public IP alone, so
# nothing else on the host is diverted. Idempotent: added only when absent.
#
# The Docker provider talks to the remote dockerd; a throwaway privileged
# container sharing the host's network namespace is how this reaches the
# HOST's iptables from here without SSH (a --net=host container shares the
# host's netfilter, so its iptables IS the host's).
resource "null_resource" "tela_hairpin" {
  count = var.coturn_enabled ? 1 : 0

  triggers = {
    public_ip  = var.coturn_public_host
    private_ip = var.mediamtx_private_host
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST = var.docker_host
      PUB         = var.coturn_public_host
      PRIV        = var.mediamtx_private_host
    }
    command = <<-EOT
      docker run --rm --privileged --net=host alpine:3.20 sh -c '
        set -eu
        apk add --no-cache iptables >/dev/null 2>&1
        iptables -t nat -C OUTPUT -p udp -d "$PUB" -j DNAT --to-destination "$PRIV" 2>/dev/null \
          || iptables -t nat -A OUTPUT -p udp -d "$PUB" -j DNAT --to-destination "$PRIV"
        iptables -t nat -C POSTROUTING -p udp -d "$PRIV" -j MASQUERADE 2>/dev/null \
          || iptables -t nat -A POSTROUTING -p udp -d "$PRIV" -j MASQUERADE
      '
    EOT
  }

  depends_on = [docker_container.coturn]
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
    # relay.
    "TELA_STUN_URLS=${var.stun_urls}",
    # Self-hosted coturn (free): when enabled, the app mints time-limited
    # credentials from the shared secret (TURN REST API) and forces the
    # browser onto the relay. The static TURN/Cloudflare inputs below stay
    # as alternatives; coturn wins when both are set.
    "TELA_TURN_URLS=${var.coturn_enabled ? "turn:${var.coturn_public_host}:${var.coturn_listen_port}?transport=udp turn:${var.coturn_public_host}:${var.coturn_listen_port}?transport=tcp" : var.turn_urls}",
    "TELA_TURN_SECRET=${var.coturn_enabled ? random_password.tela_turn_secret.result : ""}",
    "TELA_TURN_USERID=tela",
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
