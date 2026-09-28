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
      # cch-api: the same cch-frontend page calls this cross-origin for
      # the game's REST + WebSocket (see modules/apps/cch-api's own
      # README) -- same reasoning as tela-api.giomartins.dev above for
      # staying out of Access, a Google SSO redirect would break every
      # fetch/WebSocket call from the browser. Port must match
      # module.compute_apps_cch_api's external_port.
      hostname = "cch-api.giomartins.dev"
      port     = 8008
    },
    {
      # bet-api: the betting BFF. Path-protected (hub pattern -- bare
      # hostname in excluded_hostnames): the browser's fetch to /api/*
      # carries the edge-injected Cf-Access-Jwt-Assertion header and the
      # app validates that JWT itself (lib/accessAuth.ts) -- login IS
      # the Access/Google session, shared with the hub's via the
      # team-domain cookie. The bare hostname stays public because
      # bet-runner runs OUTSIDE the VPS now (home network, residential
      # IP -- the whole point after Betano's compliance wall blocked the
      # datacenter ASN): it polls /internal/* over the public hostname,
      # whose only auth is RUNNER_API_KEY (48 random chars) -- the same
      # shared secret it always used on the apps network. /health stays
      # public like every other service's. Port must match
      # module.compute_apps_bet_api's external_port.
      hostname = "bet-api.giomartins.dev"
      port     = 8009
    },
    {
      # contas-api: one of the 4 backends behind financas-frontend (the
      # personal-finance feature). Path-protected exactly like
      # harness-api (bet-api pattern -- bare hostname in
      # excluded_hostnames, /api has its own Access application, login
      # hop /api/sso included). No database of its own: persistence
      # rides domain-api's shared Postgres via the command pipeline, so
      # this container is stateless like cch-api/bet-api's callers. Port
      # must match module.compute_apps_contas_api's external_port.
      hostname = "contas-api.giomartins.dev"
      port     = 8011
    },
    {
      # transacional-api: same shape as contas-api above -- one of the 4
      # financas-frontend backends, path-protected the harness-api way,
      # no database of its own (domain-api is the persistence layer).
      # Port must match module.compute_apps_transacional_api's
      # external_port.
      hostname = "transacional-api.giomartins.dev"
      port     = 8012
    },
    {
      # asset-manager-api: same shape as contas-api above -- one of the
      # 4 financas-frontend backends, path-protected the harness-api
      # way, no database of its own (domain-api is the persistence
      # layer). Also talks to brapi.dev for market data (ASSET_MANAGER_
      # BRAPI_TOKEN). Port must match
      # module.compute_apps_asset_manager_api's external_port.
      hostname = "asset-manager-api.giomartins.dev"
      port     = 8013
    },
    {
      # dashboard-api: same shape as contas-api above -- one of the 4
      # financas-frontend backends, path-protected the harness-api way,
      # no database of its own (domain-api is the persistence layer).
      # Port must match module.compute_apps_dashboard_api's
      # external_port.
      hostname = "dashboard-api.giomartins.dev"
      port     = 8014
    },
    {
      # leads-api: the one PUBLIC financas backend -- captures e-mails
      # on the landing page before a visitor ever authenticates, so
      # unlike the 4 above it carries NO Access application at all (see
      # excluded_hostnames in root variables.tf). Port must match
      # module.compute_apps_leads_api's external_port.
      hostname = "leads-api.giomartins.dev"
      port     = 8015
    },
    {
      # clubs-api -- the FC Clubs Hub backend. The bare hostname is PUBLIC (in
      # excluded_hostnames below): the whole dataset is meant to be readable by
      # anyone with no account, which is the product. Only /api carries an
      # Access application (path_protected_hostnames), and that is where the
      # personal layer lives. Port must match module.compute_apps_clubs_api's
      # external_port (8017 -- 8016 was the last taken, by apostas-api).
      hostname = "clubs-api.giomartins.dev"
      port     = 8017
    },
    {
      # apostas-api: the BFF for the Apostas module (betting-house
      # wallet reconciliation) -- same shape as contas-api/
      # transacional-api/asset-manager-api/dashboard-api: financas' own
      # session cookie (verify-only), no Cloudflare Access, no database
      # of its own. Port must match module.compute_apps_apostas_api's
      # external_port.
      hostname = "apostas-api.giomartins.dev"
      port     = 8016
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
    {
      # Grafana — the observability front door (logs/metrics/traces
      # dashboards over the whole stack, see
      # module.compute_services_observability's README). Google-SSO
      # Access as the outer layer, exactly like beszel above; Grafana's
      # own Terraform-generated admin login is the inner one. Port must
      # match module.compute_services_observability's grafana publish.
      hostname = "grafana.giomartins.dev"
      port     = 3000
    },
    {
      # Alloy's OTLP/HTTP endpoint for the two SPAs' browsers (see that
      # module's README for the whole data flow). Deliberately excluded
      # from Access via excluded_hostnames — a public visitor's browser
      # can't pass a Google SSO redirect, and the whole point is that
      # buteco-class's and tela's visitors send telemetry without an
      # account here. The receiver's CORS allowlist (exactly these two
      # SPA origins, enforced by the browser) plus OTLP-only payloads
      # are the access control. Port must match
      # module.compute_services_observability's alloy publish.
      hostname = "otel.giomartins.dev"
      port     = 4318
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
    {
      # Image bucket for the blog's posts (covers + inline pictures).
      # Public-read on purpose and in excluded_hostnames like
      # buteco-class above: a visitor's <img> tag must load without any
      # login, and inside Discord's Activity iframe an Access redirect
      # would render every picture broken. post-api uploads here (see
      # modules/apps/post-api/src/lib/minioClient.ts); uploads stay
      # auth-gated at the API, keys are <userId>/<uuid>.<ext> so
      # nothing user-named ever lands in a public namespace.
      hostname = "media.giomartins.dev"
      bucket   = "buteco-media"
    },
    {
      # Cards Against Humanity clone, played with a room code plus the
      # room's password -- same reasoning as tela.giomartins.dev above
      # for staying out of excluded_hostnames/Access: the room password
      # is the access control, and guests never have an account here.
      hostname = "cch.giomartins.dev"
      bucket   = "cch-frontend"
    },
    {
      # The hub: chrome around every other frontend -- a sidebar plus a
      # renderer that iframes the SPAs above, plus new-tab shortcuts to
      # the Access-protected dashboards. Public on purpose (in
      # excluded_hostnames like the SPAs it renders): a visitor can
      # open the hub and every public app without an account. The
      # opt-in Google login lives on the /sso path (see
      # path_protected_hostnames below) -- the hub's frontend probes
      # it (200 = logged in, redirect = not) and only then renders the
      # shortcuts tier.
      hostname = "hub.giomartins.dev"
      bucket   = "hub-frontend"
    },
    {
      # The betting micro frontend -- public chrome around the real
      # gate, which is the Access application on
      # bet-api.giomartins.dev. Same shape as the hub's /sso probe: the
      # SPA fetches /api/me on bet-api (200 = logged in, opaque
      # redirect = not) and hops through bet-api's /api/sso for the
      # Google login. It must be iframe-embeddable in the hub like
      # cch/tela (a Google SSO redirect inside the hub's renderer frame
      # cannot be completed), hence excluded_hostnames below.
      hostname = "bet.giomartins.dev"
      bucket   = "bet-frontend"
    },
    {
      # clubs-frontend: the FC Clubs Hub SPA -- rankings, match and player
      # profiles, and the historical series the EA source does not keep. It
      # enters the hub as a microfrontend like bet/tela/cch, so it must stay
      # iframe-embeddable: the login is a Google Identity Services button the SPA
      # renders itself, not a redirect to an edge login page (which could not
      # complete inside the hub's renderer frame). That is also why clubs-api has
      # no Cloudflare Access application at all.
      hostname = "clubs.giomartins.dev"
      bucket   = "clubs-frontend"
      # clubs-api serve o preview de link (Open Graph) das páginas de detalhe
      # neste host: um crawler pedindo /club/:id, /player/:id ou /match/:id
      # recebe HTML com título, descrição e placar em vez do index.html sem
      # metadados. A porta é a mesma que o ingress usa para clubs-api
      # (locals.services); sem ela, link de clube compartilhado em Discord
      # apareceria pelado.
      og_api   = 8017
    },
    {
      # financas-frontend: the single SPA for the personal-finance
      # feature's 4 modules (contas, transações, ativos/investimentos,
      # dashboard) -- one frontend, not four, calling all 4 backends
      # cross-origin. It enters the hub as a microfrontend like bet
      # above; the real gate is each of the 4 APIs' own Access
      # application on /api, and the SPA probes one of them
      # (contas-api.giomartins.dev/api/me, same shape as the hub's
      # /sso probe) to decide whether the visitor is logged in. Must be
      # iframe-embeddable in the hub like cch/tela/bet (a Google SSO
      # redirect inside the hub's renderer frame cannot be completed),
      # hence excluded_hostnames below.
      hostname = "financas.giomartins.dev"
      bucket   = "financas-frontend"
    },
  ]

  # Paths that get a Cloudflare Access application of their own even
  # though their bare hostname is public (in excluded_hostnames). The
  # hub's /sso is its opt-in Google login: "Entrar com Google"
  # navigates there (which starts the Access flow), and the SPA probes
  # it to decide whether the admin shortcuts are shown. Enforcement of
  # the shortcut targets themselves stays on each target's own Access
  # application -- this path is the UI gate, not the security one.
  #
  # bet-api's /api is the same shape as the hub's /sso: the betting SPA
  # fetches /api/* cross-origin (the edge stamps the
  # Cf-Access-Jwt-Assertion the app verifies) and hops through /api/sso
  # for the Google login. The REST of bet-api's hostname stays public
  # on purpose: /internal/* is bet-runner's surface, and the runner
  # runs on the home network now -- a machine-to-machine client that
  # can't pass a Google SSO redirect, whose auth is the RUNNER_API_KEY
  # header the app itself checks (same secret as when it lived on the
  # apps network).
  #
  # ONE app, not two: Access cookies are domain-scoped (one
  # CF_Authorization for bet-api.giomartins.dev) but the aud claim in
  # the JWT is PER APPLICATION -- a cookie minted by an /auth app was
  # always rejected by the /api app (aud mismatch -> opaque 302 the
  # SPA's redirect:"manual" fetch can't follow), so the login hop and
  # the probe could never share a session. The SSO hop now lives UNDER
  # the /api app (bet-api route /api/sso), so one app mints and
  # consumes the cookie.
  # contas-api/transacional-api/asset-manager-api/dashboard-api used to
  # be path-protected here too (4 Access apps, one per API's /api),
  # but financas dropped Cloudflare Access entirely in favor of its own
  # Google Sign-In + session cookie (contas-api issues it, the other 3
  # only verify it) -- see FINANCAS_SESSION_SECRET/GOOGLE_OAUTH_CLIENT_ID
  # wiring below. No Access app fronts these 4 hostnames anymore.
  path_protected_hostnames = [
    "hub.giomartins.dev/sso",
    "bet-api.giomartins.dev/api",
  ]
}
