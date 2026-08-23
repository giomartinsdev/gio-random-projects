# docker-api-proxy

Workaround for a Cloudflare Tunnel quirk, not a bug in
`kreuzwerker/terraform-provider-docker` itself (an earlier version of
this README blamed the provider — corrected after a source-code trace
and an isolation test that bypassed the tunnel and worked). The
tunnel's HTTP/2→1.1 translation appears to add `Transfer-Encoding:
chunked` to originally-bodyless `POST` requests on container lifecycle
endpoints (`start`/`stop`/`restart`/`kill`/`pause`/`unpause`) — a shape
this host's Docker Engine (29.5.3, API 1.54) rejects outright.

`proxy.py` sits between `docker.giomartins.dev` (cloudflared) and the
real daemon: strips the body on exactly those lifecycle calls, passes
every other request through untouched. dockerd itself moved from
`127.0.0.1:2375` to `127.0.0.1:2376` (see the host's
`/etc/systemd/system/docker.service.d/override.conf`) so this proxy
could take over `2375` — the port `modules/infra/terraform`'s ingress
rule for `docker.giomartins.dev` actually points at.

Only `Dockerfile` and `proxy.py` live in this folder now — the
container itself runs via `modules/infra/terraform-tunnel`, which
builds this directory as its Docker build context. Not something
`modules/infra/terraform` manages directly: it's what makes that
config's own `docker_container` resources work at all, so it can't
depend on them (see `modules/infra/terraform-tunnel`'s README for the
full reasoning and how to apply it).
