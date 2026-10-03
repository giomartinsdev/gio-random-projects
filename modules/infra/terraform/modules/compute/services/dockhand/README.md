# module "compute/services/dockhand"

A Docker management UI — [Dockhand](https://dockhand.pro) — at
`dockhand.giomartins.dev`. Containers, live logs, an in-browser shell,
file/volume browsing, image CVE scanning (Grype/Trivy) and an activity
log, all in one pane. It replaces Beszel's day-to-day operational
surface; **historical metrics stay in the Grafana/Prometheus stack**
(`compute/services/observability`) — Dockhand is real-time + management,
not a time-series store.

- **`docker_container.dockhand`** — the hub (Bun/SvelteKit). Published
  loopback-only on `127.0.0.1:8093`; `compute/services/ingress` proxies
  `dockhand.giomartins.dev` to it and already forwards the WebSocket
  upgrade the terminal/live-logs need.
- **`/opt/dockhand`** (host, `DATA_DIR`) — the SQLite DB,
  `.encryption_key`, and git clones. **Back this up** (or the DB and any
  stored credentials are unrecoverable — the key can't be re-derived).
- **`/opt/stacks`** (host, `STACKS_DIR`) — the flat, host-persisted home
  for local stack files. See `stacks/README.md` at the repo root.

Both host dirs are bind-mounted at the *same* path inside the container
(matching paths), so a stack's relative bind mounts resolve on the host
without translation. They must already exist on the host — Docker would
create a missing bind source root-owned, and Terraform can't chown it.

Runs as root (`user = "0"`) with `/var/run/docker.sock` bind-mounted:
talking to the raw socket is what lets it observe/manage the host's
containers, and that access is root-equivalent however you obtain it
(the same exposure `beszel-agent`, `alloy` and `watchtower` already
have). The docs' socket-proxy (`tecnativa/docker-socket-proxy`) is the
hardening upgrade path if it ever matters.

## The ownership contract (read this before using it to change anything)

Every container still defined by this Terraform config is owned by this
same config. Dockhand talks to the same dockerd the `kreuzwerker/docker`
provider does, so **using it to recreate/edit/delete a Terraform-managed
container causes drift** and the next `terraform apply` fights for
ownership — exactly the failure watchtower caused on `domain-api` before
`watchtower_enabled` was set to false (see `compute/app/variables.tf`).

The repository is mid-migration away from that model: apps are moving to
persisted Compose stacks under `stacks/` (see `stacks/README.md` at the
repo root), managed by Dockhand and git-backed. The contract below applies
to whatever is *still* in Terraform; as an app moves to a stack, Dockhand
owns it.

For the not-yet-migrated remainder:

- **Use Dockhand for**: logs, exec shells, live stats, file/volume
  browsing, image listing + CVE scans, and the activity log.
- **Change container definitions in Terraform**, not in the UI.
- Dockhand's compose-stack feature is for hosts this config does not
  manage (a second VPS, a home box) — point it at one of those if you want
  it to own a lifecycle.

## First boot

On first launch authentication is **disabled** — anyone reaching the
URL is admin. The hostname is behind Cloudflare Access (it is not in
`excluded_hostnames`, so it gets the same Google-SSO application as
beszel/grafana), which is the outer gate; open the app once Access lets
you through and, in **Settings → Authentication**, create the local
admin user (and optionally enable MFA). That local login is the inner
gate.

Dockhand's own login is intentionally **not** the last line of defence:
the docs are explicit that it should never be exposed publicly without
an authenticating proxy in front — here that proxy is Cloudflare
Access + ingress.
