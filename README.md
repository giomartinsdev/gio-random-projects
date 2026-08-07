# gio-random-projects

Infra-as-code for gio-server: tunnels, reverse proxy config, and anything else
that keeps the server running. Each subsystem lives in its own folder under
`infra/` with its own `docker-compose.yml`, and deploys independently in
Openship (each project points at its own subfolder).

To bring everything up at once locally: `docker compose -f docker-compose.all.yml up -d`

To run the "bora." app (domain + gateway + bora-api + web) locally, built from
source rather than pulled from the registry: `docker compose -f
docker-compose.dev.yml up --build` — see that file's own header comment
for what it does and doesn't set up (no GTFS data, no telemetry).

## Host-level requirements (not tracked by any compose file)

The Docker Engine on gio-server itself needs `/etc/docker/daemon.json`:

```json
{
  "insecure-registries": ["localhost:5000", "127.0.0.1:5000"]
}
```

So Arcane (and anything else running on the same host as the `registry`
app — see `infra/arcane-templates/templates/registry`) can pull images
via `localhost:5000` instead of the public `registry.giomartins.dev`
hostname. That's deliberate, not a convenience shortcut: pulling through
the public hostname goes through Cloudflare Access, which a plain
`docker login`/pull can't satisfy (no way to send the
CF-Access-Client-Id/Secret headers — same limitation
`.github/workflows/api-build-push.yml`'s header-injecting nginx sidecar
works around for CI). Without this, same-host pulls fail with a
confusing `mediatype=text/html` / blob size-validation error — Access
intercepts and returns its own HTML login-redirect page in place of the
manifest/blob Docker asked for, and Docker chokes trying to parse HTML
as binary image content. Restart the daemon (`systemctl restart docker`)
after editing — this setting isn't hot-reloadable. See `api/compose.yaml`
for the docker login step this also requires.

**Arcane itself isn't tracked here** — it was installed via its own
official installer (not a compose file in this repo, chicken-and-egg
problem: it's the tool that manages everything else's compose files),
so nothing here persists its container config across a reinstall.
Concretely: its restart policy defaulted to `no`, not `unless-stopped`
like every app template in `infra/arcane-templates/` — a Docker daemon
restart (e.g. after the `insecure-registries` change above) killed it
and it didn't come back on its own. Fixed live with
`docker update --restart=unless-stopped arcane` (no downtime, doesn't
recreate the container) — but redo this (or pass the equivalent flag)
if Arcane is ever reinstalled from scratch.
