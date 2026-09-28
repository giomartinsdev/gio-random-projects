module "cloud_cloudflare" {
  source = "./modules/cloud/cloudflare"
  providers = {
    cloudflare = cloudflare
    tls        = tls
  }

  account_id                      = var.cloudflare_account_id
  zone_id                         = var.cloudflare_zone_id
  server_ip                       = var.server_ip
  google_idp_identity_provider_id = var.google_idp_identity_provider_id
  # static_sites' hostnames still need their own A record + Access
  # handling same as everything in services -- they're a different
  # ingress route (MinIO, not a container port), not a different DNS
  # or Access story.
  hostnames                = concat([for s in local.services : s.hostname], [for s in local.static_sites : s.hostname])
  excluded_hostnames       = var.excluded_hostnames
  path_protected_hostnames = local.path_protected_hostnames
  allowed_emails           = var.allowed_emails
  # financas dropped public_signup_hostnames -- its 4 backends have no
  # Cloudflare Access application at all anymore (own Google Sign-In +
  # session cookie instead, see contas-api's session.go). Every other
  # protected hostname -- hub, bet-api, harness-api-shaped things --
  # stays on the allowed_emails allowlist above.
  session_duration = var.session_duration
  # bet-api's /api path app is the one browser-facing cross-origin API
  # still behind Access: its SPA (bet.giomartins.dev) preflights every
  # content-type:json call, and a preflight 403s at the edge without
  # this bypass no matter how logged-in the user is (preflights carry
  # no cookies). The key is the path app's own domain string, not the
  # bare hostname -- that's what the contains() check compares against.
  # financas' 4 backends no longer need an entry here: with no Access
  # app in front of them, there's no edge-level preflight to bypass --
  # each service's own cors() middleware answers OPTIONS directly.
  preflight_bypass_hostnames = [
    "bet-api.giomartins.dev/api",
  ]

  # Email Routing lives on the zone's DNS (MX/SPF/DKIM) plus account
  # state, not on any hostname's ingress — so it slots into this
  # module rather than into compute.
  email_routing_destination = var.email_routing_destination
  email_routing_rules       = var.email_routing_rules
}

module "network_docker_apps" {
  source = "./modules/network/docker_apps"
  providers = {
    docker = docker
  }

  network_name = "apps"
}

module "storage_postgres" {
  source = "./modules/storage/postgres"
  providers = {
    docker = docker
  }

  postgres_password = random_password.postgres.result
  network_name      = module.network_docker_apps.network_name
}

module "storage_redis" {
  source = "./modules/storage/redis"
  providers = {
    docker = docker
  }

  network_name = module.network_docker_apps.network_name
}

module "storage_minio" {
  source = "./modules/storage/minio"
  providers = {
    docker = docker
  }

  network_name  = module.network_docker_apps.network_name
  root_password = random_password.minio_root_password.result
}

module "compute_apps_domain_api" {
  source = "./modules/compute/apps/domain_api"
  providers = {
    docker = docker
  }

  network_name           = module.network_docker_apps.network_name
  postgres_host          = module.storage_postgres.postgres_host
  postgres_user          = module.storage_postgres.postgres_user
  postgres_password      = random_password.postgres.result
  redis_host             = module.storage_redis.redis_host
  registry_host          = var.registry_host
  domain_api_keys        = local.domain_api_keys
  secrets_bridge_url     = length(module.compute_services_vaultwarden_bridge) > 0 ? module.compute_services_vaultwarden_bridge[0].internal_url : ""
  secrets_bridge_api_key = random_password.vaultwarden_bridge_api_key.result
  otlp_endpoint          = module.compute_services_observability.otlp_endpoint

  depends_on = [null_resource.postgres_password_sync]
}

module "compute_apps_post_api" {
  source = "./modules/compute/apps/post_api"
  providers = {
    docker = docker
  }

  network_name                 = module.network_docker_apps.network_name
  postgres_host                = module.storage_postgres.postgres_host
  postgres_user                = module.storage_postgres.postgres_user
  postgres_password            = random_password.postgres.result
  registry_host                = var.registry_host
  better_auth_secret           = random_password.post_api_better_auth_secret.result
  domain_api_key               = random_id.post_api_domain_key.hex
  discord_client_id            = var.discord_client_id
  discord_client_secret        = var.discord_client_secret
  discord_announce_webhook_url = var.discord_announce_webhook_url
  minio_endpoint               = module.storage_minio.endpoint
  minio_access_key             = module.storage_minio.root_user
  minio_secret_key             = random_password.minio_root_password.result
  otlp_endpoint                = module.compute_services_observability.otlp_endpoint

  depends_on = [null_resource.postgres_password_sync, module.compute_apps_domain_api]
}

module "compute_apps_bookclub_api" {
  source = "./modules/compute/apps/bookclub_api"
  providers = {
    docker = docker
  }

  network_name       = module.network_docker_apps.network_name
  postgres_host      = module.storage_postgres.postgres_host
  postgres_user      = module.storage_postgres.postgres_user
  postgres_password  = random_password.postgres.result
  registry_host      = var.registry_host
  better_auth_secret = random_password.post_api_better_auth_secret.result
  domain_api_key     = random_id.bookclub_api_domain_key.hex
  minio_endpoint     = module.storage_minio.endpoint
  minio_access_key   = module.storage_minio.root_user
  minio_secret_key   = random_password.minio_root_password.result
  otlp_endpoint      = module.compute_services_observability.otlp_endpoint

  depends_on = [null_resource.postgres_password_sync, module.compute_apps_domain_api, module.storage_minio]
}

module "compute_apps_classroom_api" {
  source = "./modules/compute/apps/classroom_api"
  providers = {
    docker = docker
  }

  network_name       = module.network_docker_apps.network_name
  postgres_host      = module.storage_postgres.postgres_host
  postgres_user      = module.storage_postgres.postgres_user
  postgres_password  = random_password.postgres.result
  registry_host      = var.registry_host
  better_auth_secret = random_password.post_api_better_auth_secret.result
  domain_api_key     = random_id.classroom_api_domain_key.hex
  otlp_endpoint      = module.compute_services_observability.otlp_endpoint

  depends_on = [null_resource.postgres_password_sync, module.compute_apps_domain_api]
}

# Standalone: no database, no shared auth, no domain-api. Split from
# tela-frontend (below) -- see modules/compute/apps/tela_api/main.tf.
module "compute_apps_tela_api" {
  source = "./modules/compute/apps/tela_api"
  providers = {
    docker = docker
  }

  registry_host        = var.registry_host
  sfu_public_host      = var.server_ip
  mediamtx_public_host = var.server_ip
  # The host's own private address, used by the co-located coturn relay.
  # Discovered by CI as TF_VAR_server_private_ip.
  mediamtx_private_host = var.server_private_ip
  # Self-hosted, free TURN. Off until its ports are open in the Oracle
  # Security List: with coturn on, the app forces browsers onto the relay,
  # so enabling it before 3478 and the relay range are reachable would
  # break sharing entirely.
  coturn_enabled     = var.coturn_enabled
  coturn_public_host = var.server_ip
  frontend_origins   = ["https://tela.giomartins.dev"]
  # Host-networked container — loopback endpoint, not the docker-network one.
  otlp_endpoint = module.compute_services_observability.otlp_endpoint_loopback
}

# Deals scrapers: one headless poller container per source, both off
# the same parametrized module (no ports, no hostname, NO database --
# their only write path is domain-api's POST /deals; see the
# deals_scraper module). source_base_url lives in Vaultwarden; CI
# injects it as TF_VAR_* at apply time, the repo ships none of it.
module "compute_apps_pld_scraper" {
  source = "./modules/compute/apps/deals_scraper"
  providers = {
    docker = docker
  }

  app_name         = "pld-scraper"
  network_name     = module.network_docker_apps.network_name
  domain_api_key   = random_id.deals_domain_key.hex
  registry_host    = var.registry_host
  source_base_url  = var.pld_source_url
  flaresolverr_url = module.compute_services_flaresolverr.url
  otlp_endpoint    = module.compute_services_observability.otlp_endpoint

  depends_on = [module.compute_apps_domain_api, module.compute_services_flaresolverr]
}

module "compute_apps_phb_scraper" {
  source = "./modules/compute/apps/deals_scraper"
  providers = {
    docker = docker
  }

  app_name         = "phb-scraper"
  network_name     = module.network_docker_apps.network_name
  domain_api_key   = random_id.deals_domain_key.hex
  registry_host    = var.registry_host
  source_base_url  = var.phb_source_url
  flaresolverr_url = module.compute_services_flaresolverr.url
  otlp_endpoint    = module.compute_services_observability.otlp_endpoint

  depends_on = [module.compute_apps_domain_api, module.compute_services_flaresolverr]
}

# FlareSolverr: challenge-solver for the deals scrapers — Cloudflare
# Turnstile-walls ("Just a moment...") can't be passed by the scrapers'
# static fetch; on such a 403 they hand the URL here and reuse the
# cf_clearance it wins. Idle unless a challenge actually appears.
module "compute_services_flaresolverr" {
  source = "./modules/compute/services/flaresolverr"
  providers = {
    docker = docker
  }

  network_name = module.network_docker_apps.network_name
}

# events-announcer: the announcing half the scrapers are shedding --
# drains the durable domain.events.queue (written by domain-worker's
# EventBus on every event) and posts fresh deals to Discord. Depends on
# domain-api being up, since it's the same Redis its command pipeline
# runs through.
module "compute_apps_events_announcer" {
  source = "./modules/compute/apps/events_announcer"
  providers = {
    docker = docker
  }

  app_name            = "events-announcer"
  network_name        = module.network_docker_apps.network_name
  redis_host          = module.storage_redis.redis_host
  registry_host       = var.registry_host
  discord_webhook_url = var.deals_discord_webhook_url
  otlp_endpoint       = module.compute_services_observability.otlp_endpoint

  depends_on = [module.compute_apps_domain_api]
}

# Standalone like tela_api: no database, no shared auth -- the room
# password IS the access control, same model as tela.
module "compute_apps_cch_api" {
  source = "./modules/compute/apps/cch_api"
  providers = {
    docker = docker
  }

  registry_host    = var.registry_host
  frontend_origins = ["https://cch.giomartins.dev"]
  domain_api_key   = random_id.cch_api_domain_key.hex

  # The client's first calls (boot load, legacy JSON import) need
  # domain-api up -- same ordering guarantee the other domain-api
  # consumers declare.
  depends_on = [module.compute_apps_domain_api]
}

# bet-api: the betting BFF -- path-protected behind Access (/api has
# its own Access application, login hop /api/sso included; the bare
# hostname is in excluded_hostnames for bet-runner, which polls
# /internal/* from the home network with the shared runner key),
# Access-JWT auth in-app, Postgres via the one-shot migrate container.
# The app's aud tag is passed through (BET_ACCESS_AUD --
# lib/accessAuth.ts verifies against it).
module "compute_apps_bet_api" {
  source = "./modules/compute/apps/bet_api"
  providers = {
    docker = docker
  }

  network_name      = module.network_docker_apps.network_name
  postgres_host     = module.storage_postgres.postgres_host
  postgres_user     = module.storage_postgres.postgres_user
  postgres_password = random_password.postgres.result
  registry_host     = var.registry_host
  access_aud = [
    module.cloud_cloudflare.access_app_auds["bet-api.giomartins.dev/api"],
  ]
  allowed_emails   = var.allowed_emails
  credentials_key  = random_id.bet_credentials_key.hex
  runner_api_key   = random_password.runner_api_key.result
  frontend_origins = ["https://bet.giomartins.dev", "http://localhost:5173"]
  otlp_endpoint    = module.compute_services_observability.otlp_endpoint

  depends_on = [null_resource.postgres_password_sync, module.cloud_cloudflare]
}

# contas-api: one of the 4 financas-frontend backends. No Cloudflare
# Access in front of it anymore -- it verifies the Google ID token
# financas-frontend's Identity Services button hands it, then mints
# the financas_session cookie the other 3 backends only verify. No
# database of its own: persistence rides domain-api's shared Postgres
# via the command pipeline.
module "compute_apps_contas_api" {
  source = "./modules/compute/apps/contas_api"
  providers = {
    docker = docker
  }

  network_name           = module.network_docker_apps.network_name
  registry_host          = var.registry_host
  session_secret         = random_password.financas_session_secret.result
  google_oauth_client_id = var.google_oauth_client_id
  # Empty on purpose: this app-level allowlist is a restriction on TOP
  # of "any Google account" (financas is open signup) -- there is no
  # second list to also keep in sync anymore, unlike the old
  # Access-allowlist days.
  allowed_emails   = []
  domain_api_key   = random_id.contas_api_domain_key.hex
  frontend_origins = ["https://financas.giomartins.dev", "http://localhost:5173"]
  otlp_endpoint    = module.compute_services_observability.otlp_endpoint

  depends_on = [module.compute_apps_domain_api]
}

# transacional-api: one of the 4 financas-frontend backends -- same
# shape as contas-api above, minus issuing the session (it only
# verifies).
module "compute_apps_transacional_api" {
  source = "./modules/compute/apps/transacional_api"
  providers = {
    docker = docker
  }

  network_name   = module.network_docker_apps.network_name
  registry_host  = var.registry_host
  session_secret = random_password.financas_session_secret.result
  # Empty on purpose -- see the same note on compute_apps_contas_api
  # above.
  allowed_emails   = []
  domain_api_key   = random_id.transacional_api_domain_key.hex
  frontend_origins = ["https://financas.giomartins.dev", "http://localhost:5173"]
  otlp_endpoint    = module.compute_services_observability.otlp_endpoint

  depends_on = [module.compute_apps_domain_api]
}

# asset-manager-api: one of the 4 financas-frontend backends -- same
# shape as contas-api above, plus a brapi.dev token for market quotes.
module "compute_apps_asset_manager_api" {
  source = "./modules/compute/apps/asset_manager_api"
  providers = {
    docker = docker
  }

  network_name   = module.network_docker_apps.network_name
  registry_host  = var.registry_host
  session_secret = random_password.financas_session_secret.result
  # Empty on purpose -- see the same note on compute_apps_contas_api
  # above.
  allowed_emails   = []
  domain_api_key   = random_id.asset_manager_api_domain_key.hex
  brapi_token      = var.asset_manager_brapi_token
  frontend_origins = ["https://financas.giomartins.dev", "http://localhost:5173"]
  otlp_endpoint    = module.compute_services_observability.otlp_endpoint

  depends_on = [module.compute_apps_domain_api]
}

# dashboard-api: one of the 4 financas-frontend backends -- same shape
# as contas-api above, minus issuing the session (it only verifies).
module "compute_apps_dashboard_api" {
  source = "./modules/compute/apps/dashboard_api"
  providers = {
    docker = docker
  }

  network_name   = module.network_docker_apps.network_name
  registry_host  = var.registry_host
  session_secret = random_password.financas_session_secret.result
  # Empty on purpose -- see the same note on compute_apps_contas_api
  # above.
  allowed_emails   = []
  domain_api_key   = random_id.dashboard_api_domain_key.hex
  frontend_origins = ["https://financas.giomartins.dev", "http://localhost:5173"]
  otlp_endpoint    = module.compute_services_observability.otlp_endpoint

  depends_on = [module.compute_apps_domain_api]
}

# apostas-api: the BFF for the Apostas module (betting-house wallet
# reconciliation) -- same verify-only session shape as the other 3
# non-issuing financas backends above.
module "compute_apps_apostas_api" {
  source = "./modules/compute/apps/apostas_api"
  providers = {
    docker = docker
  }

  network_name   = module.network_docker_apps.network_name
  registry_host  = var.registry_host
  session_secret = random_password.financas_session_secret.result
  # Empty on purpose -- see the same note on compute_apps_contas_api
  # above.
  allowed_emails          = []
  domain_api_key          = random_id.apostas_api_domain_key.hex
  extension_token         = random_password.apostas_extension_token.result
  extension_usuario_email = var.apostas_extension_usuario_email
  ai_api_key              = var.apostas_ai_api_key
  frontend_origins        = ["https://financas.giomartins.dev", "http://localhost:5173"]
  otlp_endpoint           = module.compute_services_observability.otlp_endpoint

  depends_on = [module.compute_apps_domain_api]
}

# leads-api: the one PUBLIC financas backend -- no access_aud/Access
# app at all (its hostname is in excluded_hostnames instead), since an
# anonymous landing-page visitor can't complete a Google SSO redirect.
module "compute_apps_leads_api" {
  source = "./modules/compute/apps/leads_api"
  providers = {
    docker = docker
  }

  network_name     = module.network_docker_apps.network_name
  registry_host    = var.registry_host
  domain_api_key   = random_id.leads_api_domain_key.hex
  frontend_origins = ["https://financas.giomartins.dev", "http://localhost:5173"]
  otlp_endpoint    = module.compute_services_observability.otlp_endpoint

  depends_on = [module.compute_apps_domain_api]
}

# proventos-worker: a daily background sweep, not a person-facing
# backend -- no hostname, no Access, no ingress route at all. It's the
# one automatic writer of ativo "provento" movimentos and their
# matching conta credit now that the manual entry is gone (see
# asset-manager-api's own registrarMovimento validation).
module "compute_apps_proventos_worker" {
  source = "./modules/compute/apps/proventos_worker"
  providers = {
    docker = docker
  }

  network_name   = module.network_docker_apps.network_name
  registry_host  = var.registry_host
  domain_api_key = random_id.proventos_worker_domain_key.hex

  depends_on = [module.compute_apps_domain_api]
}

# apostas-resultado-worker: same "daily background sweep, no
# person-facing surface" shape as proventos-worker above -- it's the
# automatic writer of aposta.resolver + the matching conta credit, so
# green/red gets decided without anyone opening the financas app. See
# this module's own doc comment (main.tf) for what it actually does
# each cycle.
module "compute_apps_apostas_resultado_worker" {
  source = "./modules/compute/apps/apostas_resultado_worker"
  providers = {
    docker = docker
  }

  network_name       = module.network_docker_apps.network_name
  registry_host      = var.registry_host
  domain_api_key     = random_id.apostas_resultado_worker_domain_key.hex
  ai_api_key         = var.apostas_ai_api_key
  sportsdata_api_key = var.apostas_sportsdata_api_key

  depends_on = [module.compute_apps_domain_api]
}

# clubs-api -- the FC Clubs Hub backend (clubs.giomartins.dev). One published
# loopback port, one hostname, no database: everything goes through domain-api.
# The bare hostname is public (the dataset is meant to be readable by anyone);
# only /api is Access-gated, which is where the personal layer lives.
module "compute_apps_clubs_api" {
  source = "./modules/compute/apps/clubs_api"
  providers = {
    docker = docker
  }

  network_name   = module.network_docker_apps.network_name
  registry_host  = var.registry_host
  domain_api_key = random_id.clubs_api_domain_key.hex
  session_secret = random_password.clubs_session_secret.result
  # Clubs' OWN Google client, not the financas one: Google checks the
  # JavaScript origin per client, so the shared client's origin mismatch was
  # exactly the production login failure. See the variable's own note.
  google_oauth_client_id = var.clubs_google_oauth_client_id
  # Host-only cookie by default: only clubs-api reads the session, so scoping it
  # to a whole domain would be more privilege than the design needs.
  session_cookie_domain = ""

  # No module.cloud_cloudflare dependency: there is no Access application in
  # front of this host anymore -- the login is our own Google Sign-In + session.
  depends_on = [module.compute_apps_domain_api]
}

# clubs-ingest -- a poller, not a service: no port, no hostname, no ingress.
# It reads the clubs it follows from domain-api, fetches their data from the EA
# source, and writes back through domain-api. Its OWN domain key, so the audit
# log can tell a worker write from a BFF write.
module "compute_apps_clubs_ingest" {
  source = "./modules/compute/apps/clubs_ingest"
  providers = {
    docker = docker
  }

  network_name   = module.network_docker_apps.network_name
  registry_host  = var.registry_host
  domain_api_key = random_id.clubs_ingest_domain_key.hex
  otlp_endpoint  = module.compute_services_observability.otlp_endpoint

  depends_on = [module.compute_apps_domain_api]
}

# bet-runner used to live here as a Docker container on the apps
# network -- Betano's compliance wall blocks the VPS's datacenter ASN
# ("Access to this page is restricted due to security and compliance
# measures"), which no selector fixes. It now runs on the home network
# (residential IP) instead: see modules/apps/bet-runner/deploy/home's
# compose file. Nothing on the VPS represents it anymore; dry_run lives
# in that .env now, and stays 1 until selectors are verified against
# the real site with receipts in hand.

module "compute_services_registry" {
  source = "./modules/compute/services/registry"
  providers = {
    docker = docker
  }

  registry_user     = var.registry_user
  registry_password = var.registry_password
}

module "compute_services_ingress" {
  source = "./modules/compute/services/ingress"
  providers = {
    docker = docker
  }

  services     = [for s in local.services : s if s.hostname != "registry.giomartins.dev"]
  static_sites = local.static_sites

  # Every app/service module's own published port has to already be
  # loopback-only for this to actually be the sole way in -- ordering
  # doesn't change correctness (nginx just 502s until a backend is up
  # either way), but starting ingress last keeps a `terraform apply`'s
  # resource ordering readable. static_sites has no container of its
  # own to depend on, but the buckets it proxies to need to already
  # exist -- see null_resource.static_site_buckets below.
  depends_on = [
    module.compute_apps_domain_api,
    module.compute_apps_post_api,
    module.compute_apps_bookclub_api,
    module.compute_apps_classroom_api,
    module.compute_apps_tela_api,
    module.compute_apps_cch_api,
    module.compute_apps_bet_api,
    module.compute_apps_contas_api,
    module.compute_apps_transacional_api,
    module.compute_apps_asset_manager_api,
    module.compute_apps_dashboard_api,
    module.compute_apps_apostas_api,
    module.compute_apps_leads_api,
    module.compute_services_registry,
    module.compute_services_monitoring,
    module.compute_services_ai_proxy,
    module.compute_services_vaultwarden,
    module.compute_services_adminer,
    module.compute_services_observability,
    module.storage_minio,
    null_resource.static_site_buckets,
  ]
}

module "compute_services_monitoring" {
  source = "./modules/compute/services/monitoring"
  providers = {
    docker = docker
  }

  network_name = module.network_docker_apps.network_name
  agent_key    = var.beszel_agent_key
}

module "compute_services_ai_proxy" {
  source = "./modules/compute/services/ai_proxy"
  providers = {
    docker = docker
  }

  network_name     = module.network_docker_apps.network_name
  jwt_secret       = random_password.ninerouter_jwt_secret.result
  initial_password = random_password.ninerouter_initial_password.result
  hostname         = "ai.giomartins.dev"
}

module "compute_services_vaultwarden" {
  source = "./modules/compute/services/vaultwarden"
  providers = {
    docker = docker
  }

  admin_token  = random_password.vaultwarden_admin_token.result
  network_name = module.network_docker_apps.network_name
}

module "compute_services_adminer" {
  source = "./modules/compute/services/adminer"
  providers = {
    docker = docker
  }

  network_name = module.network_docker_apps.network_name
}

# Grafana + loki + prometheus + tempo + alloy — logs/metrics/traces for
# everything else on this VPS, with alloy as the one OTLP front door
# (see that module's README for the data flow). Its otlp_endpoint
# output is what every compute/apps/* module feeds its containers as
# OTEL_EXPORTER_OTLP_ENDPOINT.
module "compute_services_observability" {
  source = "./modules/compute/services/observability"
  providers = {
    docker = docker
  }

  network_name           = module.network_docker_apps.network_name
  grafana_admin_password = random_password.grafana_admin_password.result
  # The origins browsers may POST telemetry from. buteco-class also runs
  # as a Discord Activity, where window.location.origin is Discord's
  # wildcard *.discordsays.com proxy — that's a real origin this
  # endpoint has to accept (the wildcard form is what the receiver's
  # CORS config matches on), or every Activity user's telemetry dies on
  # its first preflight.
  frontend_origins = [
    "https://buteco-class.giomartins.dev",
    "https://tela.giomartins.dev",
    "https://*.discordsays.com",
  ]
}

# NOTE: the Project Zomboid game server is NOT a container here — it
# runs natively on the host (the VPS is arm64 and both SteamCMD and the
# game's JVM are x86-only; they run via box64, installed and managed by
# github.com/kaanzapkinus/zomboid-b42-on-arm as a systemd service).
# A docker/zomboid module was tried first: its amd64-only image
# segfaults under QEMU emulation on this box. Don't re-add it as a
# container without solving that.

module "compute_services_vaultwarden_bridge" {
  count  = var.vaultwarden_account_email == "" ? 0 : 1
  source = "./modules/compute/services/vaultwarden_bridge"
  providers = {
    docker = docker
  }

  network_name                        = module.network_docker_apps.network_name
  registry_host                       = var.registry_host
  vaultwarden_account_email           = var.vaultwarden_account_email
  vaultwarden_account_master_password = var.vaultwarden_account_master_password
  vaultwarden_api_client_id           = var.vaultwarden_api_client_id
  vaultwarden_api_client_secret       = var.vaultwarden_api_client_secret
  bridge_api_key                      = random_password.vaultwarden_bridge_api_key.result

  depends_on = [module.compute_services_vaultwarden]
}
