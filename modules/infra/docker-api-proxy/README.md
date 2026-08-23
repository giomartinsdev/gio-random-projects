# docker-api-proxy

Workaround for a still-open bug in `kreuzwerker/terraform-provider-docker`
(tested versions 3.0.2 through 4.5.0, all affected): it sends a legacy
JSON body on `POST /containers/{id}/start` (and the equivalent
stop/restart/kill/pause/unpause calls), a request shape the Docker API
deprecated at v1.22 and rejects outright as of v1.24+. This host's
Docker Engine (29.5.3, API 1.54) rejects it every time — confirmed live
against every provider version above. Reported upstream; no fix
released as of writing.

`proxy.py` sits between `docker.giomartins.dev` (cloudflared) and the
real daemon: strips the body on exactly those lifecycle calls, passes
every other request through untouched. dockerd itself moved from
`127.0.0.1:2375` to `127.0.0.1:2376` (see the host's
`/etc/systemd/system/docker.service.d/override.conf`) so this proxy
could take over `2375` — the port `modules/infra/terraform`'s ingress
rule for `docker.giomartins.dev` actually points at.

Deployed once, by hand, alongside the daemon-side port change — not
something `modules/infra/terraform` manages itself (it's what makes
that config's own `docker_container` resources work at all, so it
can't depend on them).
