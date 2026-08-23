locals {
  all_hostnames = [for r in var.ingress_rules : r.hostname]

  protected_hostnames = toset([
    for h in local.all_hostnames : h
    if !contains(var.excluded_hostnames, h)
  ])
}
