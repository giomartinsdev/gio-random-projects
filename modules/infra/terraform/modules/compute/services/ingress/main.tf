# Single front door: everything in var.services reaches the VPS as
# http://<hostname>/ on this one port, routed by Host header to
# 127.0.0.1:<port> -- the actual app containers all bind their
# published port to loopback only (see each module's own ports/env
# block), so this is the only way in from outside the box (besides
# SSH, and registry.giomartins.dev:5000 -- see README).
resource "docker_container" "ingress" {
  name    = "ingress"
  image   = "nginx:${var.nginx_version}"
  restart = "unless-stopped"

  # Host networking, not the shared "apps" bridge network: every
  # backend it proxies to is reachable at 127.0.0.1:<port> this way,
  # regardless of whether that backend is on the apps network (its
  # published port binds to loopback on the host itself) or tela's own
  # host-mode container. A bridge network container would only see
  # other containers by their private bridge IPs, not the host's
  # loopback-bound ports.
  network_mode = "host"

  # Written straight into the container at create time -- content
  # depends only on var.services (root locals.tf), so a change there
  # recreates this container with the new routing, no separate init
  # step or volume needed.
  upload {
    content = templatefile("${path.module}/templates/default.conf.tftpl", {
      services = var.services
    })
    file = "/etc/nginx/conf.d/default.conf"
  }
}
