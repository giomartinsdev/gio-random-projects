# module "compute/monitoring"

Host and per-container CPU/memory/disk stats for gio-server —
[Beszel](https://github.com/henrygd/beszel), chosen for being a
single small Go binary on both sides, unlike heavier
Prometheus+Grafana+cAdvisor stacks this host's 8GB RAM would rather
not spend on observability.

- **`docker_container.beszel_hub`** — the dashboard + SQLite storage.
  Published only on `127.0.0.1:8090`, reached through the Cloudflare
  Tunnel at `beszel.giomartins.dev` (see the root module's
  `locals.tf`), never directly LAN- or internet-reachable.
- **`docker_container.beszel_agent`** — collects stats and waits for
  the hub to connect; never initiates anything itself. Needs
  `/var/run/docker.sock` bind-mounted to see other containers' stats,
  same as `compute/registry`'s watchtower does for redeploys.

Both join `compute/data`'s network (passed in as `network_name`, not
created here) purely so the hub can reach the agent by container name
— neither needs postgres or redis.

## Connecting the hub to the agent

The hub authenticates outbound connections to agents via an SSH
keypair it generates into its own data volume on first boot — nothing
Terraform can pre-supply, since the key doesn't exist until the hub
has actually started once. First apply:

1. `terraform apply` with `beszel_agent_key` left at its default `""`
   — the hub comes up, the agent comes up, neither knows about the
   other yet.
2. Open `https://beszel.giomartins.dev`, create the admin account,
   then **Add System** — name it (e.g. `gio-server`), host
   `beszel-agent` (the container name, resolved over the shared
   docker network), port `45876`. The dialog shows the hub's public
   key; copy it.
3. Set `beszel_agent_key` to that value and `terraform apply` again —
   this recreates `beszel_agent` with `KEY` set to it, and the system
   added in step 2 starts reporting.

Losing the hub's data volume means repeating steps 2–3 with a new
key the hub regenerates.
