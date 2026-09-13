# Terraform-generated secrets for compute/data, compute/app, and
# compute/vaultwarden -- replacing the old pattern of generating these
# by hand (openssl rand) and feeding them in as GH Action secrets.
# Terraform now owns generation, wires the values into the containers
# that need them, and pushes a copy of each into Vaultwarden itself --
# see modules/compute/vaultwarden_bridge's README for why the vault
# needs its own copy (the bridge re-serves these to domain-api/worker
# at runtime instead of the container's own baked-in env vars).
#
# registry_password and beszel_agent_key are NOT generated here.
# beszel_agent_key comes from Beszel's own dashboard. registry_password
# stays a real input (var.registry_password) because the root docker
# provider block (versions.tf) also needs it for registry_auth, and a
# provider configuration can't depend on a resource's value computed in
# the same apply (would be unknown on the very first transition apply).
# It still gets the same automation as everything else here though --
# see modules/compute/registry's docker_config_install and this file's
# registry_restart/vault_seed below -- generation is just still manual.

resource "random_password" "postgres" {
  length  = 32
  special = false
}

resource "random_password" "minio_root_password" {
  length  = 32
  special = false
}

resource "random_id" "domain_api_key" {
  byte_length = 24
}

# post-api's own key, separate from the "ci" one above (go-ci-cd.yml/ts-backend-ci-cd.yml's
# terraform apply, unrelated to any HTTP client of domain-api) -- lets
# either be rotated independently, and makes the audit log's caller
# label (see domain-api's apikey.go) actually distinguish the two.
resource "random_id" "post_api_domain_key" {
  byte_length = 24
}

# bookclub-api's own key, same reasoning as post_api_domain_key --
# Room/Message go through domain-api's CQRS pipeline same as Post, so
# this needs a caller identity there too.
resource "random_id" "bookclub_api_domain_key" {
  byte_length = 24
}

# classroom-api's own key, same reasoning as bookclub_api_domain_key --
# Room/Message go through domain-api's CQRS pipeline same as Post, so
# this needs a caller identity there too.
resource "random_id" "classroom_api_domain_key" {
  byte_length = 24
}

# the deals scrapers' own key (pld/phb-scraper's DOMAIN_API_KEY) --
# both sources share one identity ("deals-scrapers") in the audit log;
# no Vaultwarden item needed since terraform wires the key straight
# into the scraper containers' env.
resource "random_id" "deals_domain_key" {
  byte_length = 24
}

# cch-api's own key, same reasoning as post_api_domain_key -- its rooms
# and decks go through domain-api's command pipeline (cch_rooms /
# cch_custom_decks), so the audit log needs a caller identity for it.
# No Vaultwarden item: terraform wires the key straight into the
# container's env, same as the scrapers' key.
resource "random_id" "cch_api_domain_key" {
  byte_length = 24
}

# contas-api's own key, same reasoning as post_api_domain_key -- its
# accounts go through domain-api's command pipeline, so the audit log
# needs a caller identity for it.
resource "random_id" "contas_api_domain_key" {
  byte_length = 24
}

# transacional-api's own key, same reasoning as contas_api_domain_key
# -- its transactions go through domain-api's command pipeline.
resource "random_id" "transacional_api_domain_key" {
  byte_length = 24
}

# asset-manager-api's own key, same reasoning as contas_api_domain_key
# -- its assets/movements go through domain-api's command pipeline.
resource "random_id" "asset_manager_api_domain_key" {
  byte_length = 24
}

# dashboard-api's own key, same reasoning as contas_api_domain_key --
# its dashboard layouts go through domain-api's command pipeline.
resource "random_id" "dashboard_api_domain_key" {
  byte_length = 24
}

# leads-api's own key -- it never reads anything, only ever publishes
# lead.create via POST /sync, but still needs its own identity so the
# audit log can name it like every other caller.
resource "random_id" "leads_api_domain_key" {
  byte_length = 24
}

# proventos-worker's own key -- it reads GET /ativos/todos (the one
# cross-user ativo read) and publishes ativo.registerMovement/
# transacao.create via /sync, so the audit log needs a caller identity
# for it like every other module.
resource "random_id" "proventos_worker_domain_key" {
  byte_length = 24
}

# apostas-api's own key -- publishes aposta.registrar/aposta.resolver
# via /sync and creates transações (the stake debit / payout credit)
# through the shared async route, same identity-for-audit reasoning as
# every other module here.
resource "random_id" "apostas_api_domain_key" {
  byte_length = 24
}

# The HS256 secret financas' own session cookie is signed/verified
# with -- contas-api mints the cookie (after verifying the Google ID
# token), the other 3 backends only verify it. One secret shared by
# all 4 so the cookie set on .giomartins.dev is valid everywhere,
# never hardcoded per this project's usual secrets convention.
resource "random_password" "financas_session_secret" {
  length  = 48
  special = false
}

# The static shared secret the betting-slip Chrome extension sends as
# X-Extension-Token -- a service worker has no session cookie to reuse,
# and financas is a single-person product, so one token mapped to one
# fixed identity (var.apostas_extension_usuario_email) is enough. See
# apostas-api's own Config doc comment for why this isn't a general
# personal-token system. Retrieve with `terraform output -raw
# apostas_extension_token` to paste into the extension's options page.
resource "random_password" "apostas_extension_token" {
  length  = 48
  special = false
}

locals {
  domain_api_keys = "${random_id.domain_api_key.hex}:ci,${random_id.post_api_domain_key.hex}:post-api,${random_id.bookclub_api_domain_key.hex}:bookclub-api,${random_id.classroom_api_domain_key.hex}:classroom-api,${random_id.deals_domain_key.hex}:deals-scrapers,${random_id.cch_api_domain_key.hex}:cch-api,${random_id.contas_api_domain_key.hex}:contas-api,${random_id.transacional_api_domain_key.hex}:transacional-api,${random_id.asset_manager_api_domain_key.hex}:asset-manager-api,${random_id.dashboard_api_domain_key.hex}:dashboard-api,${random_id.leads_api_domain_key.hex}:leads-api,${random_id.proventos_worker_domain_key.hex}:proventos-worker,${random_id.apostas_api_domain_key.hex}:apostas-api"
}

resource "random_password" "vaultwarden_admin_token" {
  length  = 48
  special = false
}

resource "random_password" "vaultwarden_bridge_api_key" {
  length  = 32
  special = false
}

resource "random_password" "post_api_better_auth_secret" {
  length  = 48
  special = false
}

# 9router secrets — JWT signing key and dashboard initial password.
# Both Terraform-generated; retrieve NINEROUTER_INITIAL_PASSWORD from
# Vaultwarden after the first apply to log into the dashboard.
resource "random_password" "ninerouter_jwt_secret" {
  length  = 48
  special = false
}

resource "random_password" "ninerouter_initial_password" {
  length  = 24
  special = false
}

# Grafana's admin login — retrieve GRAFANA_ADMIN_PASSWORD from
# Vaultwarden after the first apply. The outer layer in front of it is
# Cloudflare Access (grafana.giomartins.dev, Google SSO — same shape as
# beszel), this is the inner one. Write-once caveat, same class of
# problem as postgres's init-only password below: Grafana creates the
# admin user on the container's FIRST boot with whatever env var it
# sees; changing the password afterwards needs the container recreated
# (tf-ci-cd.yml's replace_target dispatch: docker_container.grafana).
resource "random_password" "grafana_admin_password" {
  length  = 32
  special = false
}

# bet-api's AES-256-GCM key for the bookmaker credentials at rest
# (modules/apps/bet-api's lib/crypto.ts) -- exactly 32 raw bytes as 64
# hex chars. random_id (not random_password: alphanumeric chars like
# g-z are not hex, and Buffer.from(s, "hex") TRUNCATES at the first
# non-hex char -- the crash-loop that shipped this comment). Rotating
# it bricks every saved password (AES-GCM has no re-key), so re-save
# credentials in the bet app after a rotation.
resource "random_id" "bet_credentials_key" {
  byte_length = 32
}

# Shared secret between bet-api and bet-runner for /internal/* over the
# apps network -- the runner bypasses ingress/Access by design, this is
# its only auth.
resource "random_password" "runner_api_key" {
  length  = 48
  special = false
}

# Postgres only applies POSTGRES_PASSWORD on first init of an empty
# data volume -- changing the env var alone does nothing once the
# volume already has data, and would leave domain-api/domain-worker
# unable to connect with a DATABASE_URL that no longer matches the
# real DB password. This runs ALTER USER directly against the live
# Postgres so both stay in sync, and only fires when the generated
# password actually changes.
resource "null_resource" "postgres_password_sync" {
  triggers = {
    password = random_password.postgres.result
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST     = var.docker_host
      PG_USER         = module.storage_postgres.postgres_user
      PG_NEW_PASSWORD = random_password.postgres.result
    }
    command = <<-EOT
      docker exec postgres psql -U "$PG_USER" -d "$PG_USER" \
        -c "ALTER USER \"$PG_USER\" WITH PASSWORD '$PG_NEW_PASSWORD';"
    EOT
  }

  depends_on = [module.storage_postgres]
}

# Changing registry_password recreates htpasswd_init and
# docker_config_install (both reference it directly), but neither
# `registry` nor `watchtower` reference the password themselves, so
# nothing forces them to pick up the rewritten htpasswd/config.json
# files on their own -- see modules/compute/registry's README. A plain
# `docker restart` (not exec/attach) is enough; both just re-read their
# mounted files on startup.
resource "null_resource" "registry_restart" {
  triggers = {
    password = var.registry_password
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST = var.docker_host
    }
    command = "docker restart registry watchtower"
  }

  depends_on = [module.compute_services_registry]
}

# One group per logically-independent value (or tightly-coupled pair,
# like a service token's id+secret) -- each becomes its OWN
# null_resource below via for_each, with its OWN narrow trigger.
# Previously this was a single null_resource with every value in one
# combined trigger map: any ONE secret changing replaced the whole
# resource and resent all ~15 items through seed_vault.sh, even the
# ~14 that hadn't changed. Now only the group whose value actually
# changed reruns.
#
# KNOWN GAP, hit for real once: when TWO OR MORE groups change in the
# same apply, Terraform runs their null_resources (and thus two
# concurrent seed_vault.sh containers) in parallel by default. Both
# log into the SAME Vaultwarden account and snapshot `bw list items`
# independently -- if they race on editing the SAME existing item
# (not just creating different new ones), one process's edit can be
# silently lost even though its own container exits 0. Happened when
# domain_api_keys (edit) and bookclub_api_domain_key (new item) landed
# in one apply together: domain_api_keys' write never actually stuck.
# No proper fix yet (would need real mutual exclusion in
# seed_vault.sh, or forcing -parallelism=1 on every apply); the
# workaround is `gh workflow run` this file with `replace_target` set
# to the lost group (e.g. `null_resource.vault_seed["domain_api_keys"]`)
# on its own, once nothing else is changing concurrently.
locals {
  vault_item_groups = {
    database_url = {
      trigger = random_password.postgres.result
      items = {
        DATABASE_URL = "postgresql://${module.storage_postgres.postgres_user}:${random_password.postgres.result}@${module.storage_postgres.postgres_host}:5432/${module.storage_postgres.postgres_user}"
      }
    }
    domain_api_keys = {
      trigger = local.domain_api_keys
      items   = { DOMAIN_API_KEYS = local.domain_api_keys }
    }
    post_api_domain_key = {
      trigger = random_id.post_api_domain_key.hex
      items   = { POST_API_DOMAIN_KEY = random_id.post_api_domain_key.hex }
    }
    bookclub_api_domain_key = {
      trigger = random_id.bookclub_api_domain_key.hex
      items   = { BOOKCLUB_API_DOMAIN_KEY = random_id.bookclub_api_domain_key.hex }
    }
    classroom_api_domain_key = {
      trigger = random_id.classroom_api_domain_key.hex
      items   = { CLASSROOM_API_DOMAIN_KEY = random_id.classroom_api_domain_key.hex }
    }
    contas_api_domain_key = {
      trigger = random_id.contas_api_domain_key.hex
      items   = { CONTAS_API_DOMAIN_KEY = random_id.contas_api_domain_key.hex }
    }
    transacional_api_domain_key = {
      trigger = random_id.transacional_api_domain_key.hex
      items   = { TRANSACIONAL_API_DOMAIN_KEY = random_id.transacional_api_domain_key.hex }
    }
    asset_manager_api_domain_key = {
      trigger = random_id.asset_manager_api_domain_key.hex
      items   = { ASSET_MANAGER_API_DOMAIN_KEY = random_id.asset_manager_api_domain_key.hex }
    }
    dashboard_api_domain_key = {
      trigger = random_id.dashboard_api_domain_key.hex
      items   = { DASHBOARD_API_DOMAIN_KEY = random_id.dashboard_api_domain_key.hex }
    }
    leads_api_domain_key = {
      trigger = random_id.leads_api_domain_key.hex
      items   = { LEADS_API_DOMAIN_KEY = random_id.leads_api_domain_key.hex }
    }
    # Not Terraform-generated (a brapi.dev token comes from that
    # service's own dashboard), but seeded here anyway so CI/a human
    # can fetch it from the vault -- same reasoning as the discord
    # group above. Empty is a valid state (asset-manager-api's quote
    # lookups just fail/no-op without it).
    asset_manager_brapi_token = {
      trigger = var.asset_manager_brapi_token
      items   = { ASSET_MANAGER_BRAPI_TOKEN = var.asset_manager_brapi_token }
    }
    post_api_better_auth_secret = {
      trigger = random_password.post_api_better_auth_secret.result
      items   = { POST_API_BETTER_AUTH_SECRET = random_password.post_api_better_auth_secret.result }
    }
    # Paste into the betting-slip Chrome extension's options page --
    # see apostas-api's Config doc comment and this file's own
    # random_password.apostas_extension_token.
    apostas_extension_token = {
      trigger = random_password.apostas_extension_token.result
      items   = { APOSTAS_EXTENSION_TOKEN = random_password.apostas_extension_token.result }
    }
    vaultwarden_admin_token = {
      trigger = random_password.vaultwarden_admin_token.result
      items   = { TF_VAULTWARDEN_ADMIN_TOKEN = random_password.vaultwarden_admin_token.result }
    }
    vaultwarden_bridge_api_key = {
      trigger = random_password.vaultwarden_bridge_api_key.result
      items   = { TF_VAULTWARDEN_BRIDGE_API_KEY = random_password.vaultwarden_bridge_api_key.result }
    }
    # Not generated by Terraform (a Discord OAuth app's credentials
    # come from Discord's own developer portal, set once as
    # var.discord_client_id/secret -- see that variable's own
    # description), but seeded here anyway so CI can fetch them from
    # the vault instead of keeping its own separate copy in GitHub
    # Secrets. Empty/empty is a valid state (Discord integration
    # disabled) -- seeding two empty items is harmless. The announce
    # webhook rides in the same group: also a portal-made value, also
    # optional ("" disables the post announcer), also fetched by CI as
    # TF_VAR_discord_announce_webhook_url.
    discord = {
      trigger = "${var.discord_client_id}|${var.discord_client_secret}|${var.discord_announce_webhook_url}"
      items = {
        DISCORD_CLIENT_ID            = var.discord_client_id
        DISCORD_CLIENT_SECRET        = var.discord_client_secret
        DISCORD_ANNOUNCE_WEBHOOK_URL = var.discord_announce_webhook_url
      }
    }
    # Grouped (not 4 separate resources): these four all describe the
    # same "how do I authenticate to the registry" concern and, in
    # practice, rotate together.
    registry = {
      trigger = "${var.registry_password}|${module.cloud_cloudflare.registry_client_cert_pem}"
      items = {
        REGISTRY_PASSWORD    = var.registry_password
        REGISTRY_USERNAME    = var.registry_user
        REGISTRY_CLIENT_CERT = module.cloud_cloudflare.registry_client_cert_pem
        REGISTRY_CLIENT_KEY  = module.cloud_cloudflare.registry_client_key_pem
      }
    }
    # Each service token's id+secret are two attributes of the same
    # underlying resource -- they only ever change together, so one
    # group per hostname, not one per attribute.
    access_svc_token_domain = {
      trigger = module.cloud_cloudflare.service_token_client_ids["domain"]
      items = {
        ACCESS_SVC_TOKEN_DOMAIN_CLIENT_ID     = module.cloud_cloudflare.service_token_client_ids["domain"]
        ACCESS_SVC_TOKEN_DOMAIN_CLIENT_SECRET = module.cloud_cloudflare.service_token_client_secrets["domain"]
      }
    }
    access_svc_token_vault = {
      trigger = module.cloud_cloudflare.protected_hosts_service_token_client_ids["vault.giomartins.dev"]
      items = {
        ACCESS_SVC_TOKEN_VAULT_CLIENT_ID     = module.cloud_cloudflare.protected_hosts_service_token_client_ids["vault.giomartins.dev"]
        ACCESS_SVC_TOKEN_VAULT_CLIENT_SECRET = module.cloud_cloudflare.protected_hosts_service_token_client_secrets["vault.giomartins.dev"]
      }
    }
    access_svc_token_beszel = {
      trigger = module.cloud_cloudflare.protected_hosts_service_token_client_ids["beszel.giomartins.dev"]
      items = {
        ACCESS_SVC_TOKEN_BESZEL_CLIENT_ID     = module.cloud_cloudflare.protected_hosts_service_token_client_ids["beszel.giomartins.dev"]
        ACCESS_SVC_TOKEN_BESZEL_CLIENT_SECRET = module.cloud_cloudflare.protected_hosts_service_token_client_secrets["beszel.giomartins.dev"]
      }
    }
    access_svc_token_minio = {
      trigger = module.cloud_cloudflare.protected_hosts_service_token_client_ids["minio.giomartins.dev"]
      items = {
        ACCESS_SVC_TOKEN_MINIO_CLIENT_ID     = module.cloud_cloudflare.protected_hosts_service_token_client_ids["minio.giomartins.dev"]
        ACCESS_SVC_TOKEN_MINIO_CLIENT_SECRET = module.cloud_cloudflare.protected_hosts_service_token_client_secrets["minio.giomartins.dev"]
      }
    }
    minio = {
      trigger = random_password.minio_root_password.result
      items = {
        MINIO_ROOT_USER     = module.storage_minio.root_user
        MINIO_ROOT_PASSWORD = random_password.minio_root_password.result
      }
    }
    ninerouter = {
      trigger = "${random_password.ninerouter_jwt_secret.result}|${random_password.ninerouter_initial_password.result}"
      items = {
        NINEROUTER_JWT_SECRET       = random_password.ninerouter_jwt_secret.result
        NINEROUTER_INITIAL_PASSWORD = random_password.ninerouter_initial_password.result
      }
    }
    grafana = {
      trigger = random_password.grafana_admin_password.result
      items = {
        GRAFANA_ADMIN_PASSWORD = random_password.grafana_admin_password.result
      }
    }
    # Grouped (not 2 separate resources): both are the bet stack's
    # secrets. Terraform wires both straight into the containers (no CI
    # fetch needed); the vault items exist so a human can read the
    # values out of the vault for local dev.
    bet = {
      trigger = "${random_id.bet_credentials_key.hex}|${random_password.runner_api_key.result}"
      items = {
        BET_CREDENTIALS_KEY = random_id.bet_credentials_key.hex
        RUNNER_API_KEY      = random_password.runner_api_key.result
      }
    }
  }
}

resource "null_resource" "vault_seed" {
  for_each = local.vault_item_groups

  triggers = {
    value = each.value.trigger
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST                 = var.docker_host
      NETWORK_NAME                = module.network_docker_apps.network_name
      VAULTWARDEN_CLIENT_ID       = var.vaultwarden_api_client_id
      VAULTWARDEN_CLIENT_SECRET   = var.vaultwarden_api_client_secret
      VAULTWARDEN_MASTER_PASSWORD = var.vaultwarden_account_master_password
      ITEMS_B64 = base64encode(join("\n", [
        for name, value in each.value.items : "${name}\t${base64encode(value)}"
      ]))
    }
    command = "${path.module}/scripts/seed_vault.sh"
  }

  depends_on = [module.compute_services_vaultwarden, module.network_docker_apps, null_resource.postgres_password_sync, null_resource.registry_restart]
}
