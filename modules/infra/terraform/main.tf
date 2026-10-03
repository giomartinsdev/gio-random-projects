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
  # clubs-api has no Cloudflare Access application at all (own Google
  # Sign-In + session cookie instead), and hub is public -- login is
  # opt-in and only reveals its shortcuts tier. Every remaining
  # protected hostname stays on the allowed_emails allowlist above.
  session_duration = var.session_duration
  # Nothing needs a preflight bypass: the browser-facing API that is
  # behind Access is clubs-api, whose /api layer answers OPTIONS in its
  # own cors() middleware rather than at the edge.
  preflight_bypass_hostnames = []

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

# The VPS's own private (VCN) address. Read from the instance's metadata
# service over the same SSH channel the docker provider uses -- no new
# secret, no extra network path, and (unlike a CI-discovered TF_VAR) it can
# never go missing on an apply that forgets to set it, which would silently
# disable the coturn relay below and break screen sharing.
data "external" "vps_private_ip" {
  program = ["sh", "${path.module}/scripts/discover_private_ip.sh"]
  query = {
    docker_host = var.docker_host
  }
}

# Host-level baseline (NIC MTU + the LOCAL iptables rules in front of every
# published port). The Oracle Security List is a separate cloud layer; these
# rules are the in-VM half of "a port is actually reachable", and the MTU is
# the NIC setting Oracle images sometimes ship wrong (9000/jumbo). Encoded
# here so a rebuilt host comes back the same and nothing drifts.
module "compute_services_host_baseline" {
  source = "./modules/compute/services/host_baseline"

  docker_host = var.docker_host
  interface   = var.host_interface
  mtu         = var.host_mtu
  # Every published inbound port this stack needs, minus SSH/80/443 which
  # the base image already allows:
  #   8217  tela's MediaMTX media (udp+tcp)
  #   3478  coturn's TURN listener (udp+tcp)
  #   49160-49200  coturn's relay allocation range (udp)
  firewall_rules = [
    "udp 8217",
    "tcp 8217",
    "udp 3478",
    "tcp 3478",
    "udp 49160:49200",
  ]
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
  # The host's own private address (read from the instance itself, above),
  # used by the co-located coturn relay.
  mediamtx_private_host = data.external.vps_private_ip.result.private_ip
  # Self-hosted, free TURN relay. On by default: the relay is what makes
  # screen sharing work from a browser that can't complete the direct ICE
  # handshake. Its ports are opened by the host baseline module above, and
  # `coturn_on` in the child module falls back to STUN-only if the private
  # address or secret is somehow missing, so this can't hard-break.
  coturn_enabled     = var.coturn_enabled
  coturn_public_host = var.server_ip
  # Shared secret: tela-api mints short-lived TURN credentials with it,
  # coturn verifies them with the same value.
  coturn_secret    = random_password.tela_turn_secret.result
  frontend_origins = ["https://tela.giomartins.dev"]
  # Host-networked container — loopback endpoint, not the docker-network one.
  otlp_endpoint = module.compute_services_observability.otlp_endpoint_loopback

  # The firewall + MTU must be in place before coturn/MediaMTX are expected
  # to be reachable; also keeps the apply order readable.
  depends_on = [module.compute_services_host_baseline]
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
    module.compute_apps_tela_api,
    module.compute_apps_clubs_api,
    module.compute_services_registry,
    module.compute_services_monitoring,
    module.compute_services_dockhand,
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

# Dockhand -- the Docker management UI at dockhand.giomartins.dev. Same
# loopback-only + Access shape as monitoring above; the read-mostly
# contract with this Terraform config is in the module's own README.
module "compute_services_dockhand" {
  source = "./modules/compute/services/dockhand"
  providers = {
    docker = docker
  }

  network_name = module.network_docker_apps.network_name
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
  # The origins browsers may POST telemetry from.
  frontend_origins = [
    "https://tela.giomartins.dev",
    "https://clubs.giomartins.dev",
    "https://hub.giomartins.dev",
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
