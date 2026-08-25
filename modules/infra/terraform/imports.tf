# Import blocks are root-module-only, so these live here even though
# the resources themselves belong to module.compute_services_registry. Adopts
# the volumes the pre-Terraform compose stack created (see that
# module's main.tf for the docker_volume names) instead of erroring on
# "already exists" or, worse, silently creating empty ones that shadow
# the real data. Containers aren't imported — registry_password
# rotated as part of this cutover either way, so they're meant to be
# recreated fresh on compute_services_registry's first apply; only the data in
# these two volumes needs to survive.
import {
  to = module.compute_services_registry.docker_volume.registry_data
  id = "registry_registry-data"
}

import {
  to = module.compute_services_registry.docker_volume.registry_auth
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

# The apply that (accidentally, during the onion-architecture cutover)
# destroyed this ruleset for real means the zone may no longer have
# one for this phase to adopt -- for_each over an empty list when
# existing_custom_waf_ruleset_id is null skips the import entirely and
# lets Terraform create a fresh one instead, rather than erroring on a
# null interpolation.
import {
  for_each = local.existing_custom_waf_ruleset_id != null ? [local.existing_custom_waf_ruleset_id] : []
  to       = module.cloud_cloudflare.cloudflare_ruleset.registry_mtls_enforce
  id       = "zones/${var.cloudflare_zone_id}/${each.value}"
}
