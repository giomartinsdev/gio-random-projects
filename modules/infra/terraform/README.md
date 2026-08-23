# Terraform

Source of truth for Cloudflare (DNS, Access, tunnel routing) **and**
for gio-server's core containers (postgres, redis, api, worker).
`locals.tf`'s `ingress_rules` list is the one place a new
hostname/service gets declared — everything else derives from it:

- **`dns.tf`** — a CNAME to the tunnel for every hostname in
  `ingress_rules`, no exceptions. A plain `for_each`: remove a
  hostname and Terraform destroys the orphaned record on the next
  apply.
- **`access.tf`** — a Cloudflare Access application + Google-SSO-only
  policy for every hostname, **except** the ones listed in
  `excluded_hostnames` (`variables.tf`) — those authenticate
  themselves (registry's htpasswd, domain-api's `X-API-Key`,
  docker.giomartins.dev's own service-token policy below) and Access's
  browser-redirect login flow would break any non-browser client
  hitting them.
- **`tunnel.tf`** — pushes `ingress_rules` to Cloudflare's control
  plane as the tunnel's remote-managed config. `modules/infra/cloudflared`'s
  `cloudflared` process picks this up automatically (no local
  `--config` file — see that directory's README).
- **`docker.tf`** — a Cloudflare Access **service token** (not
  human/Google-SSO) + a dedicated Access application for
  `docker.giomartins.dev`, gating the connection `compute.tf`'s
  `docker` provider uses. Whoever holds this token's secret has
  root-equivalent control of gio-server — see that file's own warning.
- **`compute.tf`** — `docker_container`/`docker_network`/`docker_volume`
  resources for postgres, redis, api, and worker. `modules/infra/watchtower`
  still handles automatic redeploys when CI pushes a new image
  `:latest`; this is what defines the containers exist with the right
  image/env/network/volumes in the first place and repairs drift.

  **Depends on `modules/infra/docker-api-proxy`** being deployed on
  gio-server — a workaround for a still-open
  `kreuzwerker/terraform-provider-docker` bug (see that directory's
  README) that would otherwise break every `docker_container` apply.

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

6. **API token scoped for DNS, Access, and Access service tokens** — My
   Profile → API Tokens → Create Token → Custom Token with:
   - Zone / DNS / Edit (scoped to giomartins.dev)
   - Account / Access: Apps and Policies / Edit
   - Account / Access: Organizations, Identity Providers, and Groups / Read

7. **`modules/infra/docker-api-proxy` and the daemon port move** — deployed
   once by hand on gio-server, not by this Terraform config (see that
   directory's README for why). Do this before the first `compute.tf`
   apply, or every `docker_container` resource will fail with the
   upstream bug that proxy works around.

## GitHub repo secrets

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCESS_API_TOKEN` | token from step 6 |
| `CLOUDFLARE_ACCOUNT_ID` | from step 3 |
| `CLOUDFLARE_ZONE_ID` | from step 4 |
| `CLOUDFLARE_GOOGLE_IDP_ID` | from step 5 |
| `CLOUDFLARE_DOCKER_CLIENT_ID` | `docker.tf`'s service token output — set once after the first apply |
| `CLOUDFLARE_DOCKER_CLIENT_SECRET` | same, the `client_secret` output (sensitive) |
| `TF_STATE_R2_ENDPOINT` | endpoint URL from step 2 |
| `TF_STATE_R2_ACCESS_KEY_ID` | from step 2 |
| `TF_STATE_R2_SECRET_ACCESS_KEY` | from step 2 |
| `TF_POSTGRES_PASSWORD` | `compute.tf`'s postgres/api/worker password — generate: `openssl rand -base64 24` |
| `TF_DOMAIN_API_KEYS` | `compute.tf`'s api container `DOMAIN_API_KEYS` — `key:label` pairs |

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
