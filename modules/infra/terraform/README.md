# Terraform

Source of truth for Cloudflare (DNS, Access, tunnel routing) **and**
for gio-server's core containers (postgres, redis, domain-api,
domain-worker, and more as new bounded contexts show up). This root
module wires up provider configuration (`versions.tf`, the only place
`provider` blocks live — see its own comment on why) and its child
modules; it declares no resources of its own beyond that. `locals.tf`'s
`ingress_rules` list is the one place a new hostname/service gets
declared — everything else derives from it:

- **[`modules/cloudflare`](modules/cloudflare/README.md)** — DNS, Access
  applications/policies, and the tunnel's remote-managed config, for
  every hostname in `ingress_rules` (minus `excluded_hostnames`). Also
  owns the Access service token gating `docker.giomartins.dev`.
- **[`modules/compute/data`](modules/compute/data/README.md)** — the
  stateful layer: postgres, redis, the shared `apps` docker network,
  and their volumes.
- **[`modules/compute/app`](modules/compute/app/README.md)** — the
  stateless layer: `<bounded-context>-api`/`<bounded-context>-worker`
  container pairs, wired to `compute/data`'s outputs. Labeled for
  `compute/registry`'s watchtower to redeploy on a new `:latest` push.
- **[`modules/compute/registry`](modules/compute/registry/README.md)**
  — the deploy pipeline: CI's own image registry plus the watchtower
  that polls it. Depends on neither of the other compute modules; they
  depend on it implicitly, by pulling images `apps-deploy.yml` pushes
  here.
- **[`modules/compute/monitoring`](modules/compute/monitoring/README.md)**
  — Beszel: host/container CPU/memory/disk stats, at
  `beszel.giomartins.dev`. Depends only on `compute/data`'s network.

  Every compute module **depends on `modules/infra/terraform-bootstrap`'s**
  `docker-api-proxy` being deployed on gio-server — a workaround for a
  Cloudflare Tunnel quirk (HTTP/2→1.1 translation adding chunked
  encoding to bodyless requests) that would otherwise break every
  `docker_container` apply — see that directory's README.

`moved.tf` records this module's flat-to-nested-module history so
`terraform apply` updates resource addresses in state instead of
destroying and recreating live infrastructure; safe to delete once
everyone's state has picked it up.

Add a hostname to `ingress_rules` and it gets DNS + Access protection
by default the next time this applies; add it to `excluded_hostnames`
too if it needs to stay open to non-browser clients.

State lives in Cloudflare R2. The bucket itself is defined as code too
— `modules/infra/terraform-bootstrap` — not duplicated here, because this
config's own remote state can't depend on a bucket this same config
creates. See that directory's README for the (one-time, local-state,
by-hand) bootstrap run.

## One-time setup (dashboard/account steps only you can do)

1. **Run the bootstrap** (`modules/infra/terraform-bootstrap`) to create the R2
   bucket — see that directory's README. Do this first.

2. **R2 API token** — Cloudflare dashboard → R2 → Manage API Tokens →
   Create API Token → Object Read & Write, scoped to the
   `gio-homelab-tfstate` bucket the bootstrap just created. Cloudflare
   doesn't expose R2 access-key generation through Terraform (only
   bucket management) — this step can't be automated away. Note the
   **Access Key ID**, **Secret Access Key**, and the
   **jurisdiction-specific S3 endpoint** shown on the token page
   (`https://<account_id>.r2.cloudflarestorage.com`).

3. **Cloudflare Account ID** — dashboard → any domain → right sidebar
   under "API" — or Account Home → right sidebar.

4. **Zone ID** — dashboard → giomartins.dev → right sidebar under
   "API".

5. **Google identity provider ID** — Zero Trust dashboard → Settings →
   Authentication → click the existing Google provider → the ID is in
   the URL (`.../identity-providers/<this-part>`). Terraform can't
   create this provider itself (needs the Google OAuth client
   ID/secret exchange done once in the dashboard) — it only references
   an ID that must already exist.

6. **API token scoped for DNS, Access, and mTLS** — My Profile → API
   Tokens → Create Token → Custom Token with:
   - Zone / DNS / Edit (scoped to giomartins.dev)
   - Account / Access: Apps and Policies / Edit
   - Account / Access: Organizations, Identity Providers, and Groups / Read
   - Account / Access: Mutual TLS Certificates / Edit
   - Zone / SSL and Certificates / Edit (scoped to giomartins.dev — for
     `registry_mtls.tf`'s `cloudflare_certificate_authorities_hostname_associations`)

7. **`modules/infra/terraform-bootstrap`'s `cloudflared`/`docker-api-proxy`
   and the daemon port move** — applied once by hand, not by this
   Terraform config (see that directory's README for why). Do this
   before the first `compute_*` module apply, or every
   `docker_container` resource here will fail against the Cloudflare
   Tunnel quirk that proxy works around.

8. **`/etc/docker/certs.d/registry.giomartins.dev/` must already exist
   on gio-server** — `mkdir -p /etc/docker/certs.d/registry.giomartins.dev`,
   by hand, once. Docker bind mounts don't create their host-side
   source path themselves; without this,
   `compute/registry`'s `registry_client_cert_install` resource fails
   outright instead of writing the mTLS client cert there.

## GitHub repo secrets

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCESS_API_TOKEN` | token from step 6 |
| `CLOUDFLARE_ACCOUNT_ID` | from step 3 |
| `CLOUDFLARE_ZONE_ID` | from step 4 |
| `CLOUDFLARE_GOOGLE_IDP_ID` | from step 5 |
| `CLOUDFLARE_DOCKER_CLIENT_ID` | `modules/cloudflare`'s service token output — set once after the first apply |
| `CLOUDFLARE_DOCKER_CLIENT_SECRET` | same, the `client_secret` output (sensitive) |
| `TF_STATE_R2_ENDPOINT` | endpoint URL from step 2 |
| `TF_STATE_R2_ACCESS_KEY_ID` | from step 2 |
| `TF_STATE_R2_SECRET_ACCESS_KEY` | from step 2 |
| `TF_POSTGRES_PASSWORD` | postgres/domain-api/domain-worker password — generate: `openssl rand -base64 24` |
| `TF_DOMAIN_API_KEYS` | domain-api container's `DOMAIN_API_KEYS` — `key:label` pairs |
| `TF_REGISTRY_PASSWORD` | registry basic-auth password — must match `REGISTRY_PASSWORD` (used by `apps-deploy.yml`'s push step) and the host's `docker login registry.giomartins.dev` watchtower relies on — see `modules/compute/registry`'s README |
| `TF_BESZEL_AGENT_KEY` | the Beszel hub's SSH public key — blank is fine until the hub's first boot; see `modules/compute/monitoring`'s README for how to get it |
| `TF_VAULTWARDEN_ADMIN_TOKEN` | token gating `vault.giomartins.dev/admin` — generate: `openssl rand -base64 48`; see `modules/compute/vaultwarden`'s README |
| `TF_VAULTWARDEN_ACCOUNT_EMAIL` | email of your real Vaultwarden account (create it first, through the UI) — blank is fine until then; see `modules/compute/vaultwarden_bridge`'s README |
| `TF_VAULTWARDEN_ACCOUNT_PASSWORD` | that account's master password |
| `TF_VAULTWARDEN_API_CLIENT_ID` | API key `client_id` from vault.giomartins.dev → Account Settings → Security → Keys |
| `TF_VAULTWARDEN_API_CLIENT_SECRET` | matching `client_secret` |
| `TF_VAULTWARDEN_BRIDGE_API_KEY` | bearer token domain-api/domain-worker use to call the bridge — generate: `openssl rand -base64 32`; blank disables the bridge module entirely |

Once these are set, `.github/workflows/tf-deploy.yml` plans on every PR
touching this directory, and applies on push to `main` — including a
sidecar step that injects `CLOUDFLARE_DOCKER_CLIENT_ID/SECRET` as
`CF-Access-Client-Id/Secret` headers for the `docker` provider's
connection, since that provider has no way to attach custom headers
itself.

## Running locally

```bash
cat > terraform.tfvars <<EOF
cloudflare_account_id           = "<from step 3>"
cloudflare_zone_id              = "<from step 4>"
google_idp_identity_provider_id = "<from step 5>"
postgres_password                = "<generate: openssl rand -base64 24>"
domain_api_keys                  = "<key:label>"
EOF

export CLOUDFLARE_API_TOKEN=<token from step 6>
export AWS_ACCESS_KEY_ID=<from step 2>
export AWS_SECRET_ACCESS_KEY=<from step 2>

# The docker provider needs the same header-injecting proxy CI uses —
# run one locally (any HTTP proxy that adds CF-Access-Client-Id/Secret
# and forwards to https://docker.giomartins.dev works), then:
export TF_VAR_docker_host="tcp://localhost:<your local proxy port>"

terraform init -backend-config="endpoints={s3=\"<endpoint from step 2>\"}"
terraform plan
terraform apply
```

`terraform.tfvars` is gitignored — it's account-specific, not something
to commit.
