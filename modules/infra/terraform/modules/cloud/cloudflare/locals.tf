locals {
  protected_hostnames = toset([
    for h in var.hostnames : h
    if !contains(var.excluded_hostnames, h)
  ])
}
