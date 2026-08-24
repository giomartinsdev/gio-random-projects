# Import blocks are root-module-only, so these live here even though
# the resources themselves belong to module.compute_registry. Adopts
# the volumes the pre-Terraform compose stack created (see that
# module's main.tf for the docker_volume names) instead of erroring on
# "already exists" or, worse, silently creating empty ones that shadow
# the real data. Containers aren't imported — registry_password
# rotated as part of this cutover either way, so they're meant to be
# recreated fresh on compute_registry's first apply; only the data in
# these two volumes needs to survive.
import {
  to = module.compute_registry.docker_volume.registry_data
  id = "registry_registry-data"
}

import {
  to = module.compute_registry.docker_volume.registry_auth
  id = "registry_registry-auth"
}

# Every zone already has one (empty, Cloudflare-created) entry-point
# ruleset per phase — cloudflare_ruleset can't just "create" one for
# http_request_firewall_custom, since a zone can only have one and
# this zone already does (confirmed live: apply errored "exceeded
# maximum number of zone rulesets for phase
# http_request_firewall_custom"). Looked up by phase here (root-only,
# same reason as the volume imports above) rather than hardcoding an
# ID, since it's account data this config didn't create and has no
# other record of.
data "cloudflare_rulesets" "zone" {
  zone_id = var.cloudflare_zone_id
}

locals {
  existing_custom_waf_ruleset_id = one([
    for r in data.cloudflare_rulesets.zone.rulesets : r.id
    if r.phase == "http_request_firewall_custom"
  ])
}

import {
  to = module.cloudflare.cloudflare_ruleset.registry_mtls_enforce
  id = "zones/${var.cloudflare_zone_id}/${local.existing_custom_waf_ruleset_id}"
}

# watchtower redeployed both of these outside Terraform (new images
# landed in the registry from apps-deploy.yml pushes, and it does
# exactly what it's for — polls and redeploys on sight) between one
# apply and the next, so the state's tracked container IDs went stale
# and the following apply's plain `create` collided on the container
# name still held by watchtower's replacement. Importing adopts
# whatever's actually running now instead of fighting it — if that
# also happens to need replacing (e.g. an env/image mismatch), a plain
# import at least lets Terraform destroy the old one it now knows
# about before creating the new one, instead of colliding on the name
# blind.
import {
  to = module.compute_app.docker_container.domain_api
  id = "b8098ff3a7519c8c51d25364831012e5a15a080dc51f448ed5f86546e739384b"
}

import {
  to = module.compute_app.docker_container.domain_worker
  id = "ab1518ff65ee9147d691acad8fa23912babc7d9cfcb515b48c628a419b17309c"
}
