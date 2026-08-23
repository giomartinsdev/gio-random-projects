# module "cloudflare"

Everything Cloudflare: DNS records, Zero Trust Access, tunnel ingress
routing, and the Access service token the `compute/*` modules'
`docker` provider connects through.

| File | Resources |
|---|---|
| `dns.tf` | `cloudflare_dns_record` — one CNAME per `var.ingress_rules` entry |
| `access.tf` | `cloudflare_zero_trust_access_policy`/`_application` — Google SSO, one pair per non-excluded hostname |
| `tunnel.tf` | `cloudflare_zero_trust_tunnel_cloudflared`/`_config` — imports the existing tunnel, pushes remote-managed ingress |
| `docker_access.tf` | Service token + dedicated Access application for `docker.giomartins.dev` |

## Inputs

See `variables.tf`. `ingress_rules` is the important one — the same
list the root module's `locals.tf` derives from `compute/*` too, so a
hostname declared once gets DNS, Access, and tunnel routing together.

## Outputs

See `outputs.tf`. `docker_service_token_client_id`/`_client_secret`
are what the root module surfaces for the CI secrets that authenticate
the `docker` provider's connection.
