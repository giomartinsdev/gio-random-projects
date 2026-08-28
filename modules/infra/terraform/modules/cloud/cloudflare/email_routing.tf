# Cloudflare Email Routing: mail to this domain forwards to the
# destination Gmail — read it in the normal Gmail app, no server of
# ours involved, free tier. Replying as an @giomartins.dev address is
# Gmail's "Send mail as" (which is why the SPF record below merges
# Google's include on top of Cloudflare's).
#
# Two one-time manual steps this file can't do for you:
#
#  1. Cloudflare emails the destination a verification link — click it.
#     Rules only forward to VERIFIED addresses, so an apply that runs
#     before the click fails creating the rules — click, then re-run
#     the apply.
#  2. Gmail: Settings → Accounts → "Send mail as" → add the address,
#     confirm with the code that lands in the inbox (via the routing
#     above), SMTP smtp.gmail.com :587 + your Gmail App Password
#     (needs 2FA on the Google account — myaccount.google.com →
#     Security → App passwords).
#
# The MX/SPF/DMARC records are written by hand rather than copied from
# the API: the cloudflare_email_routing_dns data source returns null
# for a zone that never onboarded Email Routing (checked live —
# "Iteration over null value" on the first plan), and the onboard
# wizard's records aren't individually manageable afterwards. The one
# value that can't be written by hand is the zone-specific DKIM key —
# that comes from the data source at the bottom, which adopts it
# automatically once the API starts returning it.

locals {
  # The apex hostname. The module only receives a zone_id, and the
  # email_routing_dns data source is null for this zone, so the domain
  # is spelled out here rather than derived.
  email_zone_apex = "giomartins.dev"

  # Cloudflare generates a random priority per zone (8/19/29 on one,
  # 52/98/91 on another — verified against public zones); the values
  # have no functional effect since every host is Cloudflare's, so
  # 10/20/30 keeps it deterministic.
  email_mx_records = {
    primary = { priority = 10, host = "route1.mx.cloudflare.net" }
    second  = { priority = 20, host = "route2.mx.cloudflare.net" }
    third   = { priority = 30, host = "route3.mx.cloudflare.net" }
  }
}

resource "cloudflare_dns_record" "email_mx" {
  for_each = local.email_mx_records

  zone_id  = var.zone_id
  name     = local.email_zone_apex
  type     = "MX"
  content  = each.value.host
  priority = each.value.priority
  ttl      = 1
  comment  = "Cloudflare Email Routing (Terraform)"
}

# SPF for mail SENT as this domain: Cloudflare's include covers mail it
# routes, Google's covers the Gmail "Send mail as" identity. (DKIM for
# that sent mail is signed d=gmail.com — free Gmail can't install a
# custom DKIM key — which is exactly why DMARC below stays p=none.)
resource "cloudflare_dns_record" "email_spf" {
  zone_id = var.zone_id
  name    = local.email_zone_apex
  type    = "TXT"
  content = "v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all"
  ttl     = 1
  comment = "SPF — Cloudflare Email Routing + Gmail send-as (Terraform)"
}

# Monitor-only on purpose: quarantine/reject would quarantine the
# Gmail "send as" mail, since free Gmail can't DKIM-sign as
# giomartins.dev. Revisit if the sending path ever moves to a provider
# that signs this domain properly.
resource "cloudflare_dns_record" "email_dmarc" {
  zone_id = var.zone_id
  name    = "_dmarc.${local.email_zone_apex}"
  type    = "TXT"
  content = "v=DMARC1; p=none; rua=mailto:${var.email_routing_destination}"
  ttl     = 1
  comment = "DMARC monitor-only (Terraform)"
}

# The on/off switch for the whole feature — with no rules, forwarding
# does nothing; with rules, a disabled switch silently drops mail. The
# resource's `enabled` attribute is read-only in the v5 provider:
# creating this resource is what turns Email Routing on (deleting it
# turns it off).
resource "cloudflare_email_routing_settings" "zone" {
  zone_id = var.zone_id
}

# The destination mailbox. Creating this makes Cloudflare email it a
# verification link — until someone clicks it, every rule below fails
# to create ("destination address not verified"). Terraform can't click
# the link for you; see the file header.
resource "cloudflare_email_routing_address" "destination" {
  account_id = var.account_id
  email      = var.email_routing_destination
}

resource "cloudflare_email_routing_rule" "primary" {
  zone_id = var.zone_id
  name    = "${var.email_routing_local_part} → gmail"
  enabled = true

  matchers = [{
    type  = "literal"
    field = "to"
    value = "${var.email_routing_local_part}@${local.email_zone_apex}"
  }]

  actions = [{
    type  = "forward"
    value = [var.email_routing_destination]
  }]

  depends_on = [
    cloudflare_email_routing_settings.zone,
    cloudflare_email_routing_address.destination,
  ]
}

# Anything else @giomartins.dev lands in the same inbox — handy for
# throwaway per-service aliases (postgres@, github@, whatever@).
resource "cloudflare_email_routing_catch_all" "catch_all" {
  zone_id = var.zone_id
  name    = "catch-all → gmail"
  enabled = true

  matchers = [{
    type = "all"
  }]

  actions = [{
    type  = "forward"
    value = [var.email_routing_destination]
  }]

  depends_on = [
    cloudflare_email_routing_settings.zone,
    cloudflare_email_routing_address.destination,
  ]
}

# The zone-specific DKIM key (selector cf2024-1) is the one record that
# can't be hand-written — only Cloudflare knows the key, and it
# generates it when Email Routing is onboarded. Deliberately read at
# PLAN time (no depends_on): a depends_on defers the read to apply,
# and Terraform then rejects any for_each/count keyed on the result
# ("cannot be determined until apply" — seen on runs 33201159630 and
# 33201987778). Read at plan, the null the API returns for an
# un-onboarded zone collapses to an empty map and nothing is created;
# once the API starts returning the recommendation, the next apply
# adopts the DKIM automatically.
data "cloudflare_email_routing_dns" "recommended" {
  zone_id = var.zone_id
}

locals {
  # The API returns result.record = null for an un-onboarded zone —
  # and try() alone can't help, because null is a valid value, not an
  # error: try hands it straight through and the for-expression below
  # would still blow up ("Iteration over null value", run 33202536127).
  # try() covers the case where result itself is absent (that IS an
  # error); the explicit null check handles record being null.
  email_dns_raw = try(data.cloudflare_email_routing_dns.recommended.result.record, null)

  # Only the DKIM record survives the filter — MX and the apex SPF are
  # managed by the resources above, and adopting them here too would
  # create exact duplicates.
  email_dkim_records = {
    for rec in (local.email_dns_raw == null ? [] : local.email_dns_raw) :
    "${rec.type}:${rec.name}" => rec
    if rec.type == "TXT" && endswith(rec.name, "_domainkey.${local.email_zone_apex}")
  }
}

resource "cloudflare_dns_record" "email_dkim" {
  for_each = local.email_dkim_records

  zone_id = var.zone_id
  name    = each.value.name
  type    = "TXT"
  content = each.value.content
  ttl     = 1
  comment = "Cloudflare Email Routing DKIM (Terraform)"
}