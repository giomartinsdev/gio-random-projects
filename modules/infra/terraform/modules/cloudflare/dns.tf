# A plain for_each resource, deliberately: removing a hostname from
# var.ingress_rules removes it from this set, and Terraform destroys
# the orphaned record on the next apply — no separate prune step to
# remember or trigger.
resource "cloudflare_dns_record" "tunnel_hostname" {
  for_each = toset(local.all_hostnames)

  zone_id = var.zone_id
  name    = each.value
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  ttl     = 1 # "Auto" — required by the API when proxied is true
}
