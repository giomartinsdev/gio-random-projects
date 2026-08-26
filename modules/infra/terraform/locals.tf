# This IS the source of truth for what's exposed on the VPS — every
# child module derives from it (the cloudflare module gets the
# hostnames for DNS + Access; each compute module owns its own
# published port). Add a service by adding a hostname/port pair here:
# it gets an A record on the next apply, and once Cloudflare goes back
# in front (proxied = true), an Access application too unless listed in
# excluded_hostnames.
#
# Phase 1 of the migration: the records are grey-cloud, so each
# hostname resolves straight to the machine itself, and
# compute/services/ingress routes it from there by Host header to the
# port column below (which stays here rather than in the ingress
# module itself, since it's also what each app/service module
# publishes its container port as). Phase 2 flips proxied = true and
# the edge layers re-arm with zero further config -- ingress already
# terminates on the same port (80) Cloudflare's proxy expects.
locals {
  services = [
    {
      hostname = "registry.giomartins.dev"
      port     = 5000
    },
    {
      hostname = "domain.giomartins.dev"
      port     = 8000
    },
    {
      # Beszel's hub dashboard — host/container stats and metrics. Not
      # in excluded_hostnames, so it gets the same Google-SSO Access
      # protection as everything else browser-facing once proxied; the
      # hub has its own login too, Access is just the outer layer.
      hostname = "beszel.giomartins.dev"
      port     = 8090
    },
    {
      # Vaultwarden's own web vault GUI — same Google-SSO Access outer
      # layer as beszel above (not in excluded_hostnames),
      # Vaultwarden's own master-password login is the inner one. Port
      # must match module.compute_services_vaultwarden's published_port.
      hostname = "vault.giomartins.dev"
      port     = 8222
    },
    {
      # post-api's own Better Auth is the auth layer here, same
      # reasoning as domain.giomartins.dev — Cloudflare Access's
      # browser-redirect login would break any non-browser client (a
      # future frontend's API calls, a Discord bot). Port must match
      # module.compute_apps_post_api's external_port.
      hostname = "post-api.giomartins.dev"
      port     = 8002
    },
    {
      # bookclub-api's own Better Auth session validation is the auth
      # layer here, same reasoning as post-api.giomartins.dev --
      # Cloudflare Access's browser-redirect login would break the
      # front's own fetch/WebSocket calls. Port must match
      # module.compute_apps_bookclub_api's external_port.
      hostname = "bookclub-api.giomartins.dev"
      port     = 8004
    },
    {
      # classroom-api's own Better Auth session validation is the auth
      # layer here, same reasoning as bookclub-api.giomartins.dev --
      # Port must match module.compute_apps_classroom_api's
      # external_port.
      hostname = "classroom-api.giomartins.dev"
      port     = 8005
    },
    {
      # tela-api: the same tela-frontend page calls this cross-origin
      # for signalling/SFU (see modules/apps/tela-api's own README) --
      # same reasoning as tela.giomartins.dev above for staying out of
      # Access, a Google SSO redirect would break every fetch/WebSocket
      # call from the browser. Port must match
      # module.compute_apps_tela_api's external_port.
      hostname = "tela-api.giomartins.dev"
      port     = 8007
    },
    {
      # 9router: OpenAI-compatible AI proxy with auto-fallback across
      # 40+ providers (Claude, GPT, Gemini, …). Dashboard at /dashboard,
      # API at /v1. Excluded from Cloudflare Access (Google SSO) so CLI/
      # terminal clients (OpenCode, Claude Code, etc.) can reach /v1 directly
      # without browser redirects. Dashboard is protected by INITIAL_PASSWORD.
      # Port matches module.compute_services_ai_proxy's container port (20128).
      hostname = "ai.giomartins.dev"
      port     = 20128
    },
    {
      # MinIO console UI — object storage dashboard for managing buckets,
      # objects, and access policies. Protected by Google SSO Access as
      # the outer layer once proxied; MinIO's own root-credential login
      # is the inner one. bookclub-api and static_sites below reach the
      # API port (9000) separately -- by container name over the shared
      # docker network for the former, over loopback for the latter
      # (ingress runs on the host network, not that docker network).
      # Port here must match module.storage_minio's console publish
      # (9001).
      hostname = "minio.giomartins.dev"
      port     = 9001
    },
    {
      # Adminer — ad-hoc Postgres access for a human, gated by Google
      # SSO Access as the only outer layer (Adminer carries no DB
      # credentials of its own; its login form asks for them fresh
      # every visit — see module.compute_services_adminer's README).
      # Port must match module.compute_services_adminer's published_port.
      hostname = "adminer.giomartins.dev"
      port     = 8092
    },
  ]

  # Static SPAs served straight out of a MinIO bucket -- no container
  # running at all, unlike everything in services above. ingress
  # (compute/services/ingress) proxies these to MinIO's S3 API by path
  # (http://127.0.0.1:9000/<bucket>/<key>) instead of by container
  # port, routing a real asset (has a file extension) to its literal
  # key and everything else -- every client-side route, "/" included
  # -- straight to <bucket>/index.html, same effect a real filesystem's
  # try_files would get (see that module's own template for why a
  # 404-triggered fallback doesn't work against MinIO's API). See
  # static_sites.tf for how the bucket itself gets created and made
  # public-read.
  static_sites = [
    {
      # Screen sharing for anyone with a room code and its password --
      # same reasoning as tela-api below for staying out of
      # excluded_hostnames/Access: sharing a link with people who have
      # no account here is the whole point, and the room password is
      # the real access control.
      hostname = "tela.giomartins.dev"
      bucket   = "tela-frontend"
    },
    {
      # The blog itself -- meant to be publicly readable by anyone,
      # not just the Google-SSO-allowed emails. In excluded_hostnames
      # for that reason (Access would otherwise gate the whole site
      # behind a login only giomartinsdev's own account can pass).
      hostname = "buteco-class.giomartins.dev"
      bucket   = "buteco-class-frontend"
    },
  ]
}
