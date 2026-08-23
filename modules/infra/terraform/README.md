# Cloudflare (Terraform)

Source of truth for everything Cloudflare in this repo. Both resource
sets read the same hostname list out of
`modules/infra/cloudflared/config.yml` (`locals.tf`) — that file still owns the
tunnel's own ingress routing (which local port each hostname proxies
to), but this is what makes the hostname exist and decides how it's
gated:

- **`dns.tf`** — a CNAME to the tunnel for every hostname in
  `config.yml`, no exceptions. Replaces the old
  `sync_cloudflare_dns.py` + `dns-sync.yml`/`dns-prune.yml` pair —
  those only ever upserted, needing a separate manual prune workflow
  for stale records. A plain `for_each` doesn't have that gap: remove
  a hostname from `config.yml` and Terraform destroys the orphaned
  record on the next apply.
- **`access.tf`** — a Cloudflare Access application + Google-SSO-only
  policy for every hostname, **except** the ones listed in
  `excluded_hostnames` in `variables.tf` — those authenticate
  themselves (registry's htpasswd, domain-api's `X-API-Key`) and
  Access's browser-redirect login flow would break any non-browser
  client hitting them.

Add a hostname to `config.yml` and it gets DNS + Access protection by
default the next time this applies; add it to `excluded_hostnames`
too if it needs to stay open to non-browser clients.

State lives in Cloudflare R2. The bucket itself is defined as code too
— `modules/modules/infra/terraform-bootstrap` — not duplicated here, because this
config's own remote state can't depend on a bucket this same config
creates. See that directory's README for the (one-time, local-state,
by-hand) bootstrap run.

## One-time setup (dashboard/account steps only you can do)

1. **Run the bootstrap** (`modules/modules/infra/terraform-bootstrap`) to create the R2
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

6. **API token scoped for both DNS and Access** — My Profile → API
   Tokens → Create Token → Custom Token with:
   - Zone / DNS / Edit (scoped to giomartins.dev)
   - Account / Access: Apps and Policies / Edit
   - Account / Access: Organizations, Identity Providers, and Groups / Read

   This is broader than (and replaces) the old DNS-only token
   `dns-sync.yml` used, and is separate from the R2 token in step 2.

## GitHub repo secrets

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCESS_API_TOKEN` | token from step 6 |
| `CLOUDFLARE_ACCOUNT_ID` | from step 3 |
| `CLOUDFLARE_ZONE_ID` | from step 4 |
| `CLOUDFLARE_GOOGLE_IDP_ID` | from step 5 |
| `TF_STATE_R2_ENDPOINT` | endpoint URL from step 2 |
| `TF_STATE_R2_ACCESS_KEY_ID` | from step 2 |
| `TF_STATE_R2_SECRET_ACCESS_KEY` | from step 2 |

Once these are set, `.github/workflows/cloudflare-terraform.yml` plans
on every PR touching this directory or `config.yml`, and applies on
push to `main`.

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

terraform init -backend-config="endpoints={s3=\"<endpoint from step 2>\"}"
terraform plan
terraform apply
```

`terraform.tfvars` is gitignored — it's account-specific, not something
to commit.
