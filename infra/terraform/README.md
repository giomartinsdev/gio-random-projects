# Cloudflare Access (Terraform)

Every hostname in `infra/cloudflared/config.yml` gets a Cloudflare
Access application requiring Google SSO login, **except** the ones
listed in `excluded_hostnames` in `variables.tf` — those authenticate
themselves (registry's htpasswd, domain-api's `X-API-Key`) and Access's
browser-redirect login flow would break any non-browser client hitting
them. Add a new hostname to `config.yml` and it's protected by default
the next time this applies; add it to `excluded_hostnames` instead if
it needs to stay open to non-browser clients.

## One-time setup (dashboard/account steps only you can do)

1. **R2 bucket for state** — Cloudflare dashboard → R2 → Create bucket
   (e.g. `gio-homelab-tfstate`). Note the bucket name.

2. **R2 API token** — R2 → Manage API Tokens → Create API Token →
   Object Read & Write, scoped to that bucket. Note the **Access Key
   ID**, **Secret Access Key**, and the **jurisdiction-specific S3
   endpoint** shown on the token page
   (`https://<account_id>.r2.cloudflarestorage.com`).

3. **Cloudflare Account ID** — dashboard → any domain → right sidebar
   under "API" — or Account Home → right sidebar.

4. **Google identity provider ID** — Zero Trust dashboard → Settings →
   Authentication → click the existing Google provider → the ID is in
   the URL (`.../identity-providers/<this-part>`). Terraform can't
   create this provider itself (needs the Google OAuth client
   ID/secret exchange done once in the dashboard) — it only references
   an ID that must already exist.

5. **Access-scoped API token** — My Profile → API Tokens → Create
   Token → permission **Account / Access: Apps and Policies / Edit**,
   scoped to this account. This is a *different* token from the one
   `dns-sync.yml` uses (that one is Zone/DNS/Edit only — insufficient
   here).

## GitHub repo secrets

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCESS_API_TOKEN` | token from step 5 |
| `CLOUDFLARE_ACCOUNT_ID` | from step 3 |
| `CLOUDFLARE_GOOGLE_IDP_ID` | from step 4 |
| `TF_STATE_R2_BUCKET` | bucket name from step 1 |
| `TF_STATE_R2_ENDPOINT` | endpoint URL from step 2 |
| `TF_STATE_R2_ACCESS_KEY_ID` | from step 2 |
| `TF_STATE_R2_SECRET_ACCESS_KEY` | from step 2 |

Once these are set, `.github/workflows/access-terraform.yml` plans on
every PR touching this directory or `config.yml`, and applies on push
to `main`.

## Running locally

```bash
cat > backend.hcl <<EOF
bucket = "<bucket from step 1>"
endpoints = { s3 = "<endpoint from step 2>" }
EOF

cat > terraform.tfvars <<EOF
cloudflare_account_id           = "<from step 3>"
google_idp_identity_provider_id = "<from step 4>"
EOF

export CLOUDFLARE_API_TOKEN=<token from step 5>
export AWS_ACCESS_KEY_ID=<from step 2>
export AWS_SECRET_ACCESS_KEY=<from step 2>

terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

`backend.hcl` and `terraform.tfvars` are gitignored — they're
account-specific, not something to commit.
