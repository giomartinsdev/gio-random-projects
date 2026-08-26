# module "compute/services/ingress"

The one HTTP port open on the VPS. A single `nginx` container on the
host network, listening on `:80`, routing by `Host` header to
`127.0.0.1:<port>` for each entry in `var.services` (root `locals.tf`'s
`services` list, minus registry — see below). Every app/service module
now binds its published port to `127.0.0.1` only (an `ip = "127.0.0.1"`
in its `ports` block, or `BIND_HOST=127.0.0.1` for tela's host-network
container), so this container is the only thing standing between the
internet and any of them.

Config is generated straight from Terraform state (`templatefile` over
`templates/default.conf.tftpl`) and written into the container at
create time via the `docker_container` resource's own `upload` block —
no init container, no bind-mounted file, no separate step. Add a
hostname in root `locals.tf` and the next apply recreates this
container with the new route; nothing else to touch.

**registry.giomartins.dev stays out of this on purpose.** Docker
resolves a bare hostname (no explicit port) as HTTPS on port 443,
trying plain HTTP on that same port only if the registry is marked
insecure — never port 80. Routing it through this ingress would mean
this container also has to terminate on 443, which buys nothing today
(only CI ever talks to the registry, over its own dedicated port) for
real added complexity. It keeps its own `:5000`, published straight on
every interface — see `modules/compute/services/registry`'s README.

Nothing here depends on `network/docker_apps` — host networking reaches
every backend by its own loopback-bound port directly, whether that
backend actually lives on the shared `apps` bridge network or (tela)
on the host network itself.

**Static SPAs are a second, separate route type.** `var.static_sites`
(root `locals.tf`'s `static_sites` list) generates a `server{}` per
hostname that proxies straight to MinIO's S3 API by path
(`127.0.0.1:${var.minio_port}/<bucket>/<key>`) instead of a container
port — there's no container running behind these hostnames at all, see
`static_sites.tf`. Routing is by the URL's shape, not a 404 fallback:
nginx can't `try_files` against a proxied upstream the way it would a
real filesystem, and an `error_page 404` doesn't work either — MinIO's
S3 API answers a trailing-slash or no-extension key (`/` itself
included) with 200 and an XML bucket listing, never a 404, so that
listing would reach the browser instead of the fallback ever firing.
A path ending in a file extension is fetched by its literal key (a
genuinely missing one still 404s); everything else, every client-side
route included, goes straight to `<bucket>/index.html`.

## Why nginx, not Caddy or Traefik

Static config from a fixed, already-known list (`locals.tf`) needs
none of Caddy's automatic-HTTPS machinery (Cloudflare already
terminates real TLS in Phase 2; Phase 1 is plain HTTP everywhere) or
Traefik's label-based dynamic discovery (nothing here changes at
runtime — a new route only ever appears through a Terraform apply,
which already regenerates this file). Plain `nginx` with a generated
`server{}` block per hostname is the least moving parts for what's
actually a static mapping.
