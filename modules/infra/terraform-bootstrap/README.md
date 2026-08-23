# Terraform bootstrap

Everything that `modules/infra/terraform` (the CI-driven config) can't
manage itself, because it's what makes that config work in the first
place:

- **`cloudflare_r2_bucket.tfstate`** — the R2 bucket
  (`gio-homelab-tfstate`) both this config's own state *would* live in
  and `modules/infra/terraform`'s does. Can't depend on a bucket it's
  the one creating.
- **`docker_container.cloudflared`** — the tunnel container.
  Remote-managed (no `--config` flag): fetches its ingress rules from
  Cloudflare's control plane instead of a local file. Those rules are
  pushed by `modules/infra/terraform/modules/cloudflare`'s
  `cloudflare_zero_trust_tunnel_cloudflared_config` resource, the
  actual source of truth for what this tunnel forwards where — this
  resource only needs its own tunnel ID and credentials file.
- **`docker_image.docker_api_proxy`** / **`docker_container.docker_api_proxy`**
  — builds `./docker-api-proxy`'s `Dockerfile` and runs it.
  `docker-api-proxy/proxy.py` sits between `docker.giomartins.dev`
  (cloudflared) and the real dockerd: it strips the legacy body Docker
  deprecated at API v1.22 from container lifecycle calls
  (`start`/`stop`/`restart`/`kill`/`pause`/`unpause`), which a
  Cloudflare Tunnel quirk (its HTTP/2→1.1 translation appears to add
  `Transfer-Encoding: chunked` to what left as a bodyless `POST`)
  otherwise turns into exactly that legacy shape by the time it
  reaches this host's Docker Engine (29.5.3, API 1.54), which rejects
  it outright. dockerd itself moved from `127.0.0.1:2375` to
  `127.0.0.1:2376` (see gio-server's own
  `/etc/systemd/system/docker.service.d/override.conf`) so this proxy
  could take over `2375` — the port `modules/infra/terraform`'s
  ingress rule for `docker.giomartins.dev` actually points at.

`modules/infra/terraform`'s own `docker` provider only reaches dockerd
by going *through* `cloudflared` and `docker-api-proxy`:

```
docker provider -> (CI's header-injecting proxy) -> docker.giomartins.dev
  -> Cloudflare edge -> tunnel -> cloudflared -> docker-api-proxy -> dockerd
```

If either container were managed from inside that same config, any
apply needing to replace one (new image tag, a changed mount, anything
ForceNew) would destroy the exact channel that apply is using to talk
to Docker — mid-apply. This config sidesteps the problem entirely
instead of just moving it: its `docker` provider connects **directly**
to dockerd over an SSH port-forward, never through the tunnel. Neither
container holds data, so recreating either one here is always safe —
a few seconds of tunnel downtime, same as restarting it by hand would
cause, never a stuck apply.

Run **by hand only**, with **local state** — never wired into CI, for
both reasons above: there's nowhere durable for the bucket bootstrap's
state to live before the bucket exists, and CI's own docker provider
is exactly the connection the rest of this config exists to not
depend on.

## Running it

```bash
# In one terminal — forwards dockerd's own TCP listener
# (127.0.0.1:2376 on gio-server) to your machine. Leave this running
# for the duration of the apply.
ssh -N -L 2376:127.0.0.1:2376 gioserver@<gio-server-ip>
```

```bash
# In another terminal, from this directory
export CLOUDFLARE_API_TOKEN=<a token with Account / R2 / Edit>

cat > terraform.tfvars <<EOF
cloudflare_account_id = "<Cloudflare dashboard → Account Home → right sidebar>"
EOF

terraform init
terraform plan
terraform apply
```

`docker_host` defaults to `tcp://localhost:2376`, matching the
port-forward above — override only if you forwarded a different local
port.

## One-time setup for the tunnel credentials

```bash
# 1. Install cloudflared CLI (if not already present, on gio-server)
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# 2. Authenticate — opens a browser link, pick the giomartins.dev zone
cloudflared tunnel login

# 3. Create the tunnel (writes ~/.cloudflared/<UUID>.json)
cloudflared tunnel create gio-server

# 4. Copy the generated credentials file to where docker_container.cloudflared
#    expects it (var.creds_file_path's default — see variables.tf)
cp ~/.cloudflared/<UUID>.json ~/gio-random-projects/modules/infra/terraform-bootstrap/creds.json
```

`creds.json` and `cert.pem` are gitignored and only ever exist on
gio-server's own filesystem — treat them as secrets, back them up
outside of git (password manager / secrets vault). If
`modules/infra/terraform` is ever unreachable and the tunnel needs an
emergency local config, `cloudflared tunnel --config <file> run` still
works on the host directly — a `--config` flag always wins over remote
config when both are available.

## Recovering from a lost bootstrap state

`terraform.tfstate` is gitignored. It holds no secrets (bucket
metadata, and the two containers' non-sensitive attributes), but
losing it means a plain `terraform apply` will fail with "already
exists" for every resource here instead of adopting them. Recover with
`terraform import` per resource rather than deleting and recreating
anything:

```bash
terraform import cloudflare_r2_bucket.tfstate <account_id>/gio-homelab-tfstate
terraform import docker_container.cloudflared cloudflared
terraform import docker_container.docker_api_proxy docker-api-proxy
# docker_image.docker_api_proxy doesn't need importing — the next
# apply just rebuilds it from ./docker-api-proxy and picks up the
# existing container's image reference via the container import above.
```
