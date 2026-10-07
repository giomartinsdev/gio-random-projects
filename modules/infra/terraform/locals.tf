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
      # Vaultwarden's own web vault GUI — same Google-SSO Access outer
      # layer as the other browser-facing services above (not in
      # excluded_hostnames), Vaultwarden's own master-password login is
      # the inner one. Port must match
      # module.compute_services_vaultwarden's published_port.
      hostname = "vault.giomartins.dev"
      port     = 8222
    },
    {
      # Dockhand — Docker management UI (containers, logs, shell, file
      # browser, image CVE scans). Same Google-SSO Access outer layer as
      # vault above (not in excluded_hostnames); its own local
      # login, created on first visit, is the inner one. Port must match
      # module.compute_services_dockhand's published_port.
      #
      # Read-mostly by contract: every container here is owned by this
      # same Terraform config, so changing a container *definition*
      # belongs in Terraform, not the UI — see the module's README.
      hostname = "dockhand.giomartins.dev"
      port     = 8093
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
      # clubs-api -- the FC Clubs Hub backend. The bare hostname is PUBLIC (in
      # excluded_hostnames below): the whole dataset is meant to be readable by
      # anyone with no account, which is the product. There is no Access
      # application in front of it at all -- the personal layer does its own
      # Google Sign-In + session cookie. Port must match
      # module.compute_apps_clubs_api's external_port (8017).
      hostname = "clubs-api.giomartins.dev"
      port     = 8017
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
      # is the inner one. static_sites below reach the API port (9000)
      # separately -- over loopback, since ingress runs on the host
      # network, not the docker network.
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
      # Access as the outer layer, exactly like vault above; Grafana's
      # own Terraform-generated admin login is the inner one. Port must
      # match module.compute_services_observability's grafana publish.
      hostname = "grafana.giomartins.dev"
      port     = 3000
    },
    {
      # RabbitMQ management UI — the durable command bus + event fanout behind
      # the domain services (see stacks/persistence.yml). Browser-facing
      # dashboard, so it gets the same Google-SSO Access outer layer as
      # vault/adminer/grafana above (not in excluded_hostnames); RabbitMQ's own
      # management login is the inner one. Port must match
      # stacks/persistence.yml's loopback publish (15672). The AMQP port (5672)
      # is never published — only the internal `apps` network reaches it.
      hostname = "rabbit.giomartins.dev"
      port     = 15672
    },
    {
      # Evolution API — gateway do WhatsApp (Baileys) que publica todo evento
      # no RabbitMQ (exchange topic `evolution`). Browser-facing manager em
      # /manager, então ganha o mesmo Access Google-SSO de vault/adminer/
      # grafana acima (não está em excluded_hostnames); a apikey global da
      # própria Evolution é a segunda camada. Port must match stacks/compute.yml's
      # loopback publish (8080).
      hostname = "evolution.giomartins.dev"
      port     = 8080
    },
    {
      # OpenMausBot — milind-soni/OpenMausBot: a chat app whose roster is a
      # team of AI bots (each with a model, a computer and connected apps).
      # ONLY the DNS A record is managed here (the hostname is in
      # excluded_hostnames): the containers themselves are the Dockhand git
      # stack stacks/maus.yml, like every other app. No Cloudflare Access app
      # — the app's own pairing login is the gate, and the chat streams (SSE)
      # can't sit behind a Google SSO redirect, so the ingress route disables
      # buffering. Port must match stacks/maus.yml's host publish (8799) —
      # the omb container publishes that through its Caddy sidecar.
      hostname = "maus.giomartins.dev"
      port     = 8799
    },
    {
      # finance-api -- o backend do bounded context financeiro
      # (stacks/finance.yml). A porta e a loopback publicada pelo stack
      # (127.0.0.1:8018) e tem de bater com o server{} de
      # stacks/ingress/default.conf. AUTH proprio (X-API-Key), sem Cloudflare
      # Access -- o SPA (finance.giomartins.dev) chama este host cross-origin
      # pelo browser, e um redirect de SSO Google quebraria toda chamada
      # (mesma razao de clubs-api). O hostname esta em excluded_hostnames.
      hostname = "finance-api.giomartins.dev"
      port     = 8018
    },
    {
      # prospecta-api -- o backend/BFF do contexto Prospecta (stacks/prospecta.yml).
      # A porta e a loopback publicada pelo stack (127.0.0.1:8022) e tem de bater
      # com o server{} de stacks/ingress/default.conf. AUTH proprio (X-API-Key),
      # sem Cloudflare Access -- o SPA (prospecta.giomartins.dev) chama este host
      # cross-origin pelo browser, e um redirect de SSO Google quebraria toda
      # chamada (mesma razao de finance-api/clubs-api). O hostname esta em
      # excluded_hostnames.
      hostname = "prospecta-api.giomartins.dev"
      port     = 8022
    },
    {
      # Alloy's OTLP/HTTP endpoint for the SPAs' browsers (see that
      # module's README for the whole data flow). Deliberately excluded
      # from Access via excluded_hostnames — a public visitor's browser
      # can't pass a Google SSO redirect, and the whole point is that
      # tela's, clubs' and hub's visitors send telemetry without an
      # account here. The receiver's CORS allowlist (exactly those SPA
      # origins, enforced by the browser) plus OTLP-only payloads
      # are the access control. Port must match
      # module.compute_services_observability's alloy publish.
      hostname = "otel.giomartins.dev"
      port     = 4318
    },
    {
      # db-mcp -- MCP de leitura do banco (stacks/db-mcp.yml) para o agente.
      # A porta e a loopback publicada pelo gateway (127.0.0.1:8021) e tem de
      # bater com o server{} de stacks/ingress/default.conf. AUTH proprio
      # (token bearer no gateway), sem Cloudflare Access -- um cliente MCP
      # nao-browser nao completa o redirect de SSO. O hostname esta em
      # excluded_hostnames.
      hostname = "db-mcp.giomartins.dev"
      port     = 8021
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
      # The hub: chrome around the other frontends -- a sidebar plus a
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
      # clubs-frontend: the FC Clubs Hub SPA -- rankings, match and player
      # profiles, and the historical series the EA source does not keep. It
      # enters the hub as a microfrontend like tela, so it must stay
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
      og_api = 8017
    },
    {
      # finance-frontend: a SPA do bounded context financeiro (tela de
      # operacao da fatia 1 -- liveness, chave de API e envio de comando).
      # Entra no hub como microfrontend, entao precisa ser publica e
      # iframe-embeddable (em excluded_hostnames): o login e a X-API-Key que o
      # operador cola na propria tela, nao um redirect de Access. Ela chama a
      # finance-api (finance-api.giomartins.dev) cross-origin por CORS.
      hostname = "finance.giomartins.dev"
      bucket   = "finance-frontend"
    },
    {
      # prospecta-frontend: a SPA do contexto Prospecta (cockpit de prospeccao --
      # empresas, campanhas, leads, conversas). Entra no hub como microfrontend,
      # entao precisa ser publica e iframe-embeddable (em excluded_hostnames): o
      # login e a X-API-Key que o operador cola na propria tela, nao um redirect
      # de Access. Ela chama a prospecta-api (prospecta-api.giomartins.dev)
      # cross-origin por CORS.
      hostname = "prospecta.giomartins.dev"
      bucket   = "prospecta-frontend"
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
  # clubs does its own Google Sign-In + session cookie (clubs-api has no
  # Access application in front of it), so it needs no entry here either.
  path_protected_hostnames = [
    "hub.giomartins.dev/sso",
  ]
}
