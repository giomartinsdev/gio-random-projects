# Dockhand: a Docker management UI (containers, live logs, an exec
# terminal, file/volume browser, image CVE scanning, activity log) at
# dockhand.giomartins.dev. It takes over Beszel's day-to-day
# operational surface; historical metrics/alerts stay in the
# Grafana/Prometheus stack (compute/services/observability).
#
# READ-MOSTLY BY CONTRACT, not by enforcement: every container on this
# host is owned by this same Terraform config. If Dockhand is used to
# recreate, edit or delete a Terraform-managed container, the docker
# provider loses track of it and the next `terraform apply` fights for
# ownership — the exact failure watchtower caused on domain-api (see
# compute/app/variables.tf's watchtower_enabled, now false). Use
# Dockhand for logs, shells, stats, file browsing and image scanning;
# change any container *definition* in Terraform. Its compose-stack
# feature is for hosts this config does not manage.
#
# Runs as root (user = "0") because it talks to the raw Docker socket:
# that access is root-equivalent however you gain it (the same exposure
# beszel-agent/alloy/watchtower already have here), the non-root
# alternative needs a host-specific docker GID match, and the doc's
# socket-proxy hardening is the upgrade path if it ever matters. The
# published port is loopback-only and the hostname sits behind
# Cloudflare Access — the same outer gate as beszel/grafana. Dockhand's
# own local login (created on first visit) is the inner one.
#
# MATCHING PATHS, on purpose: DATA_DIR (/opt/dockhand) and STACKS_DIR
# (/opt/stacks) are host bind mounts at the *same* path inside the
# container, so a compose stack that bind-mounts ./config resolves to a
# file the daemon can see on the host without translation. Both dirs
# exist on the host already (DATA_DIR was migrated off the old
# dockhand_data named volume); a missing dir would make Docker create
# it root-owned, and the operator can't `chown` what Terraform can't
# reach, so create them out of band and keep them here.

resource "docker_container" "dockhand" {
  name    = "dockhand"
  image   = "fnsys/dockhand:${var.image_tag}"
  restart = "unless-stopped"
  user    = "0"

  env = [
    # Both are the matching paths above: everything dockhand persists
    # (SQLite DB, .encryption_key, git clones) lives under DATA_DIR,
    # and local (socket) stack files live flat under STACKS_DIR.
    "DATA_DIR=/opt/dockhand",
    "STACKS_DIR=/opt/stacks",
    # Optional Prometheus endpoint at /metrics (auth-gated while login
    # is enabled — see the module README). Harmless if nothing scrapes.
    "EXPORT_METRICS=true",
    # TLS terminates at Cloudflare's edge, so the request ingress
    # forwards is plain HTTP — without this Dockhand would infer the
    # session cookie should not be Secure. TRUST_FORWARDED_HEADERS
    # makes the activity log record the real client IP (ingress sets
    # X-Forwarded-For) instead of the ingress container's.
    "COOKIE_SECURE=true",
    "TRUST_FORWARDED_HEADERS=true",
  ]

  # Loopback-only: compute/services/ingress is the only thing that
  # reaches this directly, proxying dockhand.giomartins.dev to
  # 127.0.0.1:8093. Ingress already forwards the WebSocket upgrade
  # Dockhand needs for its terminal and live logs.
  ports {
    ip       = "127.0.0.1"
    internal = 3000
    external = var.published_port
  }

  networks_advanced {
    name = var.network_name
  }

  # Matching path: the host's /opt/dockhand is the container's
  # /opt/dockhand (DATA_DIR). Holds the SQLite DB and .encryption_key —
  # back this up or stored credentials are unrecoverable.
  mounts {
    type   = "bind"
    source = var.data_dir
    target = var.data_dir
  }

  # Matching path for stack files (STACKS_DIR). Persisted on the host
  # so a Dockhand container recreate never loses a stack's compose/.env.
  mounts {
    type   = "bind"
    source = var.stacks_dir
    target = var.stacks_dir
  }

  # See the header: this is what lets Dockhand observe and manage the
  # host's containers at all. Read-only would break the exec terminal
  # and file browser (both go through the Docker exec API).
  mounts {
    type   = "bind"
    source = "/var/run/docker.sock"
    target = "/var/run/docker.sock"
  }

  log_opts = {
    "max-size" = "10m"
    "max-file" = "3"
  }
}
