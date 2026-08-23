# gio-random-projects

Infra-as-code for gio-server: tunnels, reverse proxy config, and anything else
that keeps the server running. This repo is meant to always mirror what's
actually deployed — nothing declared here should be dangling with no service
behind it.

Each subsystem lives in its own folder under `infra/` with its own
`docker-compose.yml` (or `compose.yaml`), deployed independently.

## `infra/cloudflared`

The tunnel that exposes services publicly. `config.yml`'s `ingress` list is
the source of truth for what's reachable from the internet — add a hostname
back here when a service is redeployed behind it (this file still owns the
tunnel's own routing: which local port each hostname proxies to).

## `infra/terraform`

Everything else Cloudflare — DNS and Zero Trust Access — driven off the
same hostname list in `infra/cloudflared/config.yml`. A hostname added
there gets a DNS record and Access protection automatically on the next
apply (`.github/workflows/cloudflare-terraform.yml`, plans on PRs, applies
on push to main). See that directory's README for the one-time account
setup and `infra/terraform-bootstrap` for how its own state bucket exists.

## `infra/arcane-templates`

Reusable Arcane compose templates for self-hosted apps (registry, MinIO,
Prefect, observability stack, etc.) — not deployed by default, pick one when
you actually need it.

## Currently deployed on gio-server

Nothing beyond the cloudflared tunnel itself right now. Apps get added back
here as they're rebuilt.
