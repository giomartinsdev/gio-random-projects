# Terraform tunnel

Manages the two containers on gio-server that sit *underneath* the
Cloudflare Tunnel everything else depends on: `cloudflared` itself,
and `docker-api-proxy` in front of dockerd. State lives in the same R2
bucket `modules/infra/terraform` uses (own key, `tunnel/terraform.tfstate`
— see `modules/infra/terraform-bootstrap` for how that bucket came to
exist), but this config is otherwise fully independent, applied by
hand, and never wired into CI.

## Why this can't just live in `modules/infra/terraform`

`modules/infra/terraform`'s `docker` provider only ever reaches
dockerd by going *through* the very things this config manages:

```
docker provider -> (CI's header-injecting proxy) -> docker.giomartins.dev
  -> Cloudflare edge -> tunnel -> cloudflared -> docker-api-proxy -> dockerd
```

If `cloudflared` or `docker-api-proxy` were resources in that config
too, any apply that needed to replace either of them (new image tag, a
changed mount, anything ForceNew) would destroy the exact channel that
same apply is using to talk to Docker — mid-apply. Best case it just
errors; worst case it leaves the tunnel down with no automated way to
bring it back, needing a manual SSH recovery either way.

This config sidesteps the problem entirely instead of just moving it:
its `docker` provider connects **directly** to dockerd over an SSH
port-forward, never through the tunnel. Recreating `cloudflared` here
never touches the connection this config is using to recreate it,
because that connection was never going through `cloudflared` in the
first place.

## Running it

```bash
# In one terminal — forwards dockerd's own TCP listener
# (127.0.0.1:2376 on gio-server, see docker.service.d/override.conf)
# to your machine. Leave this running for the duration of the apply.
ssh -N -L 2376:127.0.0.1:2376 gioserver@<gio-server-ip>
```

```bash
# In another terminal, from this directory
export AWS_ACCESS_KEY_ID=<R2 access key, same as modules/infra/terraform's>
export AWS_SECRET_ACCESS_KEY=<R2 secret key>

terraform init -backend-config="endpoints={s3=\"<R2 endpoint>\"}"
terraform plan
terraform apply
```

`docker_host` defaults to `tcp://localhost:2376`, matching the
port-forward above — override only if you forwarded a different local
port.

## What each resource does

- **`docker_container.cloudflared`** — remote-managed (no `--config`
  flag): fetches its ingress rules from Cloudflare's control plane
  instead of a local file. Those rules are pushed by
  `modules/infra/terraform/modules/cloudflare`'s
  `cloudflare_zero_trust_tunnel_cloudflared_config` resource, the
  actual source of truth for what this tunnel forwards where — this
  resource only needs to know its own tunnel ID and credentials file.
- **`docker_image.docker_api_proxy`** / **`docker_container.docker_api_proxy`**
  — builds `../docker-api-proxy`'s `Dockerfile` against whatever
  daemon `docker_host` points at (rebuilding whenever `proxy.py` or the
  Dockerfile change, via the resource's `triggers`) and runs it. See
  that directory's own README for what bug it works around.

Both containers use `network_mode = "host"` — `docker-api-proxy` needs
to reach dockerd's `127.0.0.1:2376` listener as if it were running
directly on gio-server, and `cloudflared` needs to reach every other
locally-published service (registry, api, docker-api-proxy) the same
way.

## First apply on an already-running pair

The first time this runs against a gio-server that already has
`cloudflared`/`docker-api-proxy` running from
`modules/infra/cloudflared` and `modules/infra/docker-api-proxy`'s
compose files, stop and remove those by hand first
(`docker stop cloudflared docker-api-proxy && docker rm cloudflared docker-api-proxy`)
so this config's `docker_container` resources aren't blocked by a
name conflict. Neither container holds data, so there's nothing to
import or preserve — just a few seconds of tunnel downtime during the
cutover while `terraform apply` recreates them, same as restarting
either by hand would cause.
