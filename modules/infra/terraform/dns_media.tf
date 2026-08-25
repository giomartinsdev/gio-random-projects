# The one DNS record here that is NOT proxied.
#
# Every other hostname in this config is a CNAME to the tunnel with the
# orange cloud on, which is what puts Cloudflare in front of the HTTP
# traffic. Media can't work that way: WebRTC is UDP straight to the
# host, and the tunnel only carries HTTP. A proxied name resolves to
# Cloudflare, so a browser told to send media there would send it into a
# void.
#
# So this is a plain A record with the grey cloud: it resolves to the
# machine itself. tela's SFU resolves it at startup and advertises the
# result in its ICE candidates.
#
# The trade-off is the usual one for taking something off the proxy:
# this record publishes the machine's address, with no Cloudflare in
# front of it. Only the SFU's single UDP port needs to be reachable
# there -- nothing else should be exposed on that address.
resource "cloudflare_dns_record" "tela_media" {
  count = var.tela_sfu_media_hostname != "" && var.tela_sfu_media_ip != "" ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = var.tela_sfu_media_hostname
  type    = "A"
  content = var.tela_sfu_media_ip
  proxied = false
  ttl     = 300 # short: a home connection's address changes without warning
}
