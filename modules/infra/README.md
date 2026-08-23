# modules/infra

- **`terraform/`** — source of truth for Cloudflare (DNS, Zero Trust
  Access, tunnel routing) **and** gio-server's core containers
  (postgres, redis, api, worker, registry, watchtower — all via the
  `docker` provider). Deployed by `.github/workflows/tf-deploy.yml`.
  See its own README for the full picture.
- **`terraform-bootstrap/`** — creates the R2 bucket `terraform/`'s
  state lives in. One-time, by hand, local state — see its own README.
- **`cloudflared/`** — the tunnel container itself. Remote-managed (no
  local ingress config — `terraform/modules/cloudflare` pushes that);
  this folder is just `docker-compose.yml` plus the gitignored
  credentials.
- **`docker-api-proxy/`** — workaround for a Cloudflare Tunnel quirk
  (HTTP/2→1.1 translation adding chunked encoding to bodyless
  requests) that would otherwise break every `docker_container` apply.
  Deployed once by hand alongside a daemon port change — see its own
  README.

`watchtower/` and `registry/` (the pre-Terraform compose stacks for
both) are gone — see `terraform/modules/compute/registry`, which
replaced them.

## Currently deployed on gio-server

`cloudflared`, `docker-api-proxy`, and everything `terraform/`
manages: `postgres`/`redis` (`modules/compute/data`), `api`/`worker`
(`modules/compute/app`), `registry`/`watchtower`
(`modules/compute/registry`).
