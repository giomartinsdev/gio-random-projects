# This IS the source of truth for what's exposed on gio-server — every
# child module derives from ingress_rules (directly, or via the
# cloudflare module's outputs). Add a service by adding a
# hostname/service pair here; it gets DNS, Access protection (unless
# excluded), and a tunnel route on the next apply.
locals {
  ingress_rules = [
    {
      hostname = "registry.giomartins.dev"
      service  = "http://localhost:5000"
    },
    {
      hostname = "domain.giomartins.dev"
      service  = "http://localhost:8000"
    },
    {
      # dockerd listening on loopback only (never on the LAN interface,
      # never with its own TLS) — this hostname plus Cloudflare
      # Access's service-token policy (modules/cloudflare/docker_access.tf)
      # is the entire auth boundary. See modules/infra/docker-api-proxy's
      # README for the daemon-side setup this depends on.
      hostname = "docker.giomartins.dev"
      service  = "http://localhost:2375"
    },
  ]
}
