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
# The DNS records come from the API itself (data source below): the
# three MX to route{1,2,3}.mx.cloudflare.net, the zone's DKIM key and
# the SPF suggestion. Only the apex SPF is re-created by hand, because
# the verbatim recommendation lacks the Google include.

data "cloudflare_email_routing_dns" "recommended" {
  zone_id = var.zone_id
}

locals {
  # The apex hostname as the API spells it (e.g. "giomartins.dev") —
  # derived rather than hardcoded so SPF/DMARC/rule names can't drift
  # from what Cloudflare itself expects for this zone.
  email_zone_apex = [for rec in data.cloudflare_email_routing_dns.recommended.result.record : rec.name if rec.type == "MX"][0]

  # Cloudflare's recommended set minus the apex SPF (re-created below
  # with the Google include merged in). Keyed on type+name+content so
  # any change Cloudflare makes to the recommendation shows up as a
  # replace of exactly the changed record.
  email_routing_records = {
    for rec in data.cloudflare_email_routing_dns.recommended.result.record :
    "${rec.type}:${rec.name}:${rec.content}" => rec
    if !(rec.type == "TXT" && startswith(rec.content, "v=spf1"))
  }
}

resource "cloudflare_dns_record" "email_routing" {
  for_each = local.email_routing_records

  zone_id = var.zone_id
  name    = each.value.name
  type    = each.value.type
  content = each.value.content
  # Only MX carries a priority; sending one for a TXT is what the API
  # rejects, and null is what non-MX records expect.
  priority = each.value.type == "MX" ? each.value.priority : null
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