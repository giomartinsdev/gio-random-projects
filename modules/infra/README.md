# modules/infra

Two Terraform configs, nothing else:

- **`terraform/`** — source of truth for Cloudflare (DNS, Zero Trust
  Access, tunnel routing) **and** gio-server's core containers
  (postgres, redis, api, worker, registry, watchtower — all via the
  `docker` provider). Deployed by `.github/workflows/tf-deploy.yml`.
  See its own README for the full picture.
- **`terraform-bootstrap/`** — everything `terraform/` can't manage
  itself because it's what makes that config work in the first place:
  the R2 bucket its state lives in, and the `cloudflared` +
  `docker-api-proxy` containers its `docker` provider connects
  *through* to reach dockerd. Applied by hand only, never CI, with
  local state — see its own README for why, and for the SSH
  port-forward that lets it reach dockerd directly instead of through
  the tunnel it partly manages.

`watchtower/` and `registry/` (the pre-Terraform compose stacks for
both) are gone — see `terraform/modules/compute/registry`, which
replaced them.

## Currently deployed on gio-server

`cloudflared` and `docker-api-proxy` (via `terraform-bootstrap/`), and
everything `terraform/` manages: `postgres`/`redis`
(`modules/compute/data`), `api`/`worker` (`modules/compute/app`),
`registry`/`watchtower` (`modules/compute/registry`).
