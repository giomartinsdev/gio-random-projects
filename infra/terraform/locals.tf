# This IS the source of truth for what's exposed on gio-server — dns.tf,
# access.tf, and tunnel.tf all derive from ingress_rules. Add a service
# by adding a hostname/service pair here; it gets DNS, Access
# protection (unless excluded), and a tunnel route on the next apply.
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
  ]

  all_hostnames = [for r in local.ingress_rules : r.hostname]

  protected_hostnames = toset([
    for h in local.all_hostnames : h
    if !contains(var.excluded_hostnames, h)
  ])
}
