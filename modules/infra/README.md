# modules/infra

- **`terraform/`** — source of truth for Cloudflare (DNS, Zero Trust
  Access, tunnel routing) **and** gio-server's core containers
  (postgres, redis, api, worker via the `docker` provider). Deployed
  by `.github/workflows/tf-deploy.yml`. See its own README for the
  full picture.
- **`terraform-bootstrap/`** — creates the R2 bucket `terraform/`'s
  state lives in. One-time, by hand, local state — see its own README.
- **`cloudflared/`** — the tunnel container itself. Remote-managed (no
  local ingress config — `terraform/tunnel.tf` pushes that); this
  folder is just `docker-compose.yml` plus the gitignored credentials.
- **`docker-api-proxy/`** — workaround for a still-open
  `kreuzwerker/terraform-provider-docker` bug that would otherwise
  break every `docker_container` apply against this host's Docker
  Engine version. Deployed once by hand alongside a daemon port change
  — see its own README.
- **`watchtower/`** — polls `registry.giomartins.dev` and redeploys any
  container labeled for it. The pull-based half of
  `.github/workflows/apps-deploy.yml`'s CD — gio-server has no inbound
  access a push-based deploy could use.
- **`registry/`** — this repo's own Docker registry, htpasswd-gated.
  `apps-deploy.yml` pushes here; `watchtower/` pulls from here.
  Requires `REGISTRY_PASSWORD` in its `.env` — no default.

## Currently deployed on gio-server

`cloudflared`, `docker-api-proxy`, `watchtower`, `registry`, and
`postgres`/`redis`/`api`/`worker` (created by `terraform/compute.tf`,
kept updated by `watchtower`).
