# Root module enxuto: depois da migração pra stacks persistidas
# (Dockhand, ver stacks/README.md no root do repo), o Terraform só cuida
# do que NÃO é container:
#
#   - Cloudflare: DNS, Access, service tokens, mTLS do registry, email
#     routing (module.cloud_cloudflare).
#   - A rede docker `apps` (module.network_docker_apps) — as stacks a
#     referenciam como `external: true`, então ela precisa continuar
#     existindo (não gerenciada por stack).
#   - O baseline do host (MTU + iptables) — firewall in-VM, não container.
#
# Tudo que era container (storage, compute/services, compute/apps) virou
# stack; os módulos correspondentes foram removidos deste config e os
# recursos tirados do state (`terraform state rm`) sem destruir.

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

# A rede `apps` saiu do Terraform: agora é criada pelo `stacks/bootstrap.yml`
# (one-shot idempotente, com o socket do docker). As stacks a referenciam
# como `external: true`, então numa VPS nova suba o bootstrap antes. O
# `module.network_docker_apps` foi removido do state (state rm, sem destruir).

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
