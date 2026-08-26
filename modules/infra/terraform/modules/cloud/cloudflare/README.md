# module "cloudflare"

Everything Cloudflare: DNS records, Zero Trust Access (both the
Google-SSO applications and the non-interactive service-token ones),
and registry.giomartins.dev's mTLS setup.

| File | Resources |
|---|---|
| `dns.tf` | `cloudflare_dns_record` — one A record per `var.hostnames` entry, orange-cloud through Cloudflare (real TLS at the edge) except `local.direct_hostnames` — registry.giomartins.dev stays grey because its :5000 docker protocol can't transit the proxy |
| `zone_settings.tf` | `cloudflare_zone_setting` — pins the zone's SSL/TLS mode to `flexible`: the edge dials origin :80, where ingress listens. Anything stricter 521s (no :443 listener at the origin) |
| `access.tf` | `cloudflare_zero_trust_access_policy`/`_application` — Google SSO, one pair per non-excluded hostname (enforces only once records are proxied) |
| `service_token_access.tf` | Service token + dedicated Access application per hostname in `local.service_token_hostnames` (`domain.giomartins.dev`) — the second layer for hostnames that can't take a browser-redirect login flow |
| `registry_mtls.tf` | A locally-generated CA + client certificate, and the Cloudflare resources that require it at the edge for `registry.giomartins.dev` — the second layer for the one hostname that can't even take custom HTTP headers (Docker's push/pull tooling) |

## Inputs

See `variables.tf`. `hostnames` and `server_ip` are the important ones
— derived from the root module's `locals.tf`, so a hostname declared
once gets DNS and Access together.

## Outputs

See `outputs.tf`. `service_token_client_ids`/`_client_secrets` are
what the root module surfaces for the CI secrets that authenticate
each service-token-gated connection; `registry_client_cert_pem`/
`_key_pem` are the mTLS identity `compute/services/registry` installs
onto the VPS and the build workflows need installed wherever they run.
