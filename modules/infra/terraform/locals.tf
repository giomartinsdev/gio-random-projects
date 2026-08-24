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
      # is the entire auth boundary. See modules/infra/terraform-bootstrap's
      # README for the daemon-side setup this depends on.
      hostname = "docker.giomartins.dev"
      service  = "http://localhost:2375"
    },
    {
      # Beszel's hub dashboard — host/container stats and metrics. Not
      # in excluded_hostnames, so it gets the same Google-SSO Access
      # protection as everything else browser-facing; the hub has its
      # own login too, Access is just the outer layer.
      hostname = "beszel.giomartins.dev"
      service  = "http://localhost:8090"
    },
    {
      # Vaultwarden's own web vault GUI — same Google-SSO Access outer
      # layer as beszel above (not in excluded_hostnames), Vaultwarden's
      # own master-password login is the inner one. Port must match
      # module.compute_vaultwarden's published_port.
      hostname = "vault.giomartins.dev"
      service  = "http://localhost:8222"
    },
    {
      # post-api's own Better Auth is the auth layer here, same
      # reasoning as domain.giomartins.dev — in excluded_hostnames,
      # Cloudflare Access's browser-redirect login would break any
      # non-browser client (a future frontend's API calls, a Discord
      # bot). Port must match module.compute_post_api's external_port.
      hostname = "post-api.giomartins.dev"
      service  = "http://localhost:8002"
    },
    {
      # bookclub-api's own Better Auth session validation is the auth
      # layer here, same reasoning as post-api.giomartins.dev --
      # Cloudflare Access's browser-redirect login would break the
      # front's own fetch/WebSocket calls. Port must match
      # module.compute_bookclub_api's external_port.
      hostname = "bookclub-api.giomartins.dev"
      service  = "http://localhost:8004"
    },
    {
      # The blog itself -- meant to be publicly readable by anyone,
      # not just the Google-SSO-allowed emails. In excluded_hostnames
      # for that reason (Access would otherwise gate the whole site
      # behind a login only giomartinsdev's own account can pass).
      # Port must match module.compute_front's external_port.
      hostname = "classroom-bdd.giomartins.dev"
      service  = "http://localhost:8003"
    },
    {
      # 9router: OpenAI-compatible AI proxy with auto-fallback across
      # 40+ providers (Claude, GPT, Gemini, …). Dashboard at /dashboard,
      # API at /v1. Protected by Google SSO Access (same as beszel/vault)
      # as the outer auth layer; the dashboard has its own login inside.
      # Port matches module.compute_ninerouter's container port (20128).
      hostname = "ai.giomartins.dev"
      service  = "http://localhost:20128"
    },
    {
      # MinIO console UI — object storage dashboard for managing buckets,
      # objects, and access policies. Protected by Google SSO Access as
      # the outer layer; MinIO's own root-credential login is the inner
      # one. The API port (9000) stays internal-only (no ingress rule) —
      # only bookclub-api reaches it by container name over the shared
      # docker network. Port must match the published_port in
      # module.compute_minio (9001).
      hostname = "minio.giomartins.dev"
      service  = "http://localhost:9001"
    },
  ]
}
