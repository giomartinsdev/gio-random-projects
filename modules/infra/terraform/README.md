# Terraform

Source of truth for Cloudflare (DNS, Access, registry mTLS) **and** for
the VPS's core containers (postgres, redis, minio, the APIs, the front,
and every service module). This root module wires up provider
configuration (`versions.tf`, the only place `provider` blocks live)
and its child modules; it declares no resources of its own beyond
that. `locals.tf`'s `services` list is the one place a new
hostname/port pair gets declared — everything else derives from it:

- **[`modules/cloud/cloudflare`](modules/cloud/cloudflare/README.md)** —
  one A record per hostname (grey-cloud → the VPS IP until the proxy
  flip), Access applications/policies/service tokens for everything not
  in `excluded_hostnames`, and registry.giomartins.dev's mTLS chain +
  WAF enforcement rule.
- **[`modules/network/docker_apps`](modules/network/docker_apps/README.md)**
  — the shared `apps` docker network every container joins.
- **[`modules/storage/*`](modules/storage/postgres/README.md)** —
  postgres, redis, minio: stateful, internal-only (no published ports
  except minio's console).
- **[`modules/compute/apps/*`](modules/compute/apps/domain_api/README.md)**
  — domain-api (+worker), post-api, bookclub-api, classroom-api,
  tela, front: stateless app containers, each publishing its port from
  `locals.tf` straight on the host.
- **[`modules/compute/services/*`](modules/compute/services/registry/README.md)**
  — registry (+watchtower), beszel monitoring, 9router, vaultwarden
  (+bridge), adminer.

## Where the traffic goes

Phase 1 (current): every DNS record is a **grey-cloud A record → the
VPS IP**, so each service is reached directly as
`http://<hostname>:<port>` or `http://<server_ip>:<port>` — nothing
sits in front of anything. The docker provider connects to dockerd over
plain SSH (`ssh://`), so there is no exposed Docker API endpoint at all.

Phase 2 (later): flip `proxied = true` on
`modules/cloud/cloudflare/dns.tf`'s record resource in one apply. The
Access applications, WAF ruleset, and registry mTLS hostname
association this config already manages start enforcing again the
moment traffic flows through Cloudflare's edge — no other change.

## State

State lives in Cloudflare R2. The bucket itself is defined as code too
— `modules/infra/terraform-bootstrap` — not duplicated here, because
this config's own remote state can't depend on a bucket this same
config creates. See that directory's README for the (one-time,
local-state, by-hand) bootstrap run.

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

7. **SSH key for CI on the VPS** — generate a dedicated keypair
   (`ssh-keygen -t ed25519 -f vps-deploy -N ""`), add the public key to
   the VPS user's `~/.ssh/authorized_keys`, give that user passwordless
   docker access (either membership in the `docker` group or sudo
   rules). The private key becomes the `VPS_SSH_PRIVATE_KEY` repo
   secret; the IP/host becomes `VPS_HOST`.

8. **`/etc/docker/certs.d/registry.giomartins.dev/` must already exist
   on the VPS** — `sudo mkdir -p /etc/docker/certs.d/registry.giomartins.dev`,
   by hand, once. Docker bind mounts don't create their host-side
   source path themselves; without this,
   `compute/services/registry`'s `registry_client_cert_install`
   resource fails outright instead of writing the mTLS client cert
   there. (Same for `/root/.docker`: created automatically on any
   modern distro, but verify if `docker_config_install` complains.)

## GitHub repo secrets

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCESS_API_TOKEN` | token from step 6 |
| `CLOUDFLARE_ACCOUNT_ID` | from step 3 |
| `CLOUDFLARE_ZONE_ID` | from step 4 |
| `CLOUDFLARE_GOOGLE_IDP_ID` | from step 5 |
| `VPS_SSH_PRIVATE_KEY` | deploy keypair's private half, from step 7 |
| `VPS_HOST` | the VPS IP/hostname (`ssh-keyscan` target), from step 7 |
| `TF_STATE_R2_ENDPOINT` | endpoint URL from step 2 |
| `TF_STATE_R2_ACCESS_KEY_ID` | from step 2 |
| `TF_STATE_R2_SECRET_ACCESS_KEY` | from step 2 |
| `TF_REGISTRY_PASSWORD` | registry basic-auth password — must match `REGISTRY_PASSWORD` (used by the deploy workflows' push step) and the host's `docker login registry.giomartins.dev` watchtower relies on — see `modules/compute/services/registry`'s README |
| `TF_BESZEL_AGENT_KEY` | the Beszel hub's SSH public key — blank is fine until the hub's first boot; see `modules/compute/services/monitoring`'s README for how to get it |
| `TF_VAULTWARDEN_ACCOUNT_EMAIL` | email of your real Vaultwarden account (create it first, through the UI) — blank is fine until then; see `modules/compute/services/vaultwarden_bridge`'s README |
| `TF_VAULTWARDEN_ACCOUNT_PASSWORD` | that account's master password |
| `TF_VAULTWARDEN_API_CLIENT_ID` | API key `client_id` from the vault UI → Account Settings → Security → Keys |
| `TF_VAULTWARDEN_API_CLIENT_SECRET` | matching `client_secret` |
| `REGISTRY_USERNAME` / `REGISTRY_PASSWORD` | used by the build workflows' `docker login`/push step |
| `REGISTRY_CLIENT_CERT` / `REGISTRY_CLIENT_KEY` | mTLS client cert for pushes through Cloudflare — outputs of the first apply |

Everything else the containers need (postgres password, API keys,
Better Auth secrets, vaultwarden admin token, 9router credentials, …)
is generated by Terraform itself — see `secrets.tf` — and seeded into
Vaultwarden automatically. Retrieve with `terraform output` after an
apply.

Once these are set, `.github/workflows/tf-ci-cd.yml` plans on every PR
touching this directory, and applies on push to `main`. Its docker
provider step needs no proxy anymore: it installs
`VPS_SSH_PRIVATE_KEY` into `~/.ssh` and lets the provider's
`ssh://docker_host` talk to the VPS directly.

## Running locally

```bash
cat > terraform.tfvars <<EOF
cloudflare_account_id           = "<from step 3>"
cloudflare_zone_id              = "<from step 4>"
google_idp_identity_provider_id = "<from step 5>"
EOF

export CLOUDFLARE_API_TOKEN=<token from step 6>
export AWS_ACCESS_KEY_ID=<from step 2>
export AWS_SECRET_ACCESS_KEY=<from step 2>

# The docker provider connects to the VPS over SSH — just make sure
# your agent holds a key the VPS accepts:
ssh-add ~/.ssh/<your vps key>

terraform init -backend-config="endpoints={s3=\"<endpoint from step 2>\"}"
terraform plan
terraform apply
```

`terraform.tfvars` is gitignored — it's account-specific, not something
to commit.
