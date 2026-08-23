# module "cloudflare"

Everything Cloudflare: DNS records, Zero Trust Access (both the
Google-SSO applications and the non-interactive service-token ones),
tunnel ingress routing, and registry.giomartins.dev's mTLS setup.

| File | Resources |
|---|---|
| `dns.tf` | `cloudflare_dns_record` — one CNAME per `var.ingress_rules` entry |
| `access.tf` | `cloudflare_zero_trust_access_policy`/`_application` — Google SSO, one pair per non-excluded hostname |
| `tunnel.tf` | `cloudflare_zero_trust_tunnel_cloudflared`/`_config` — imports the existing tunnel, pushes remote-managed ingress |
| `service_token_access.tf` | Service token + dedicated Access application per hostname in `local.service_token_hostnames` (`docker.giomartins.dev`, `domain.giomartins.dev`) — the second layer for hostnames that can't take a browser-redirect login flow |
| `registry_mtls.tf` | A locally-generated CA + client certificate, and the Cloudflare resources that require it at the edge for `registry.giomartins.dev` — the second layer for the one hostname that can't even take custom HTTP headers (Docker's push/pull tooling) |

## Inputs

See `variables.tf`. `ingress_rules` is the important one — the same
list the root module's `locals.tf` derives from `compute/*` too, so a
hostname declared once gets DNS, Access, and tunnel routing together.

## Outputs

See `outputs.tf`. `service_token_client_ids`/`_client_secrets` are
what the root module surfaces for the CI secrets that authenticate
each service-token-gated connection; `registry_client_cert_pem`/
`_key_pem` are the mTLS identity `compute/registry` installs onto
gio-server and `apps-deploy.yml` needs installed wherever it runs.
