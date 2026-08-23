# Cloudflare Access (Terraform)

Every hostname in `infra/cloudflared/config.yml` gets a Cloudflare
Access application requiring Google SSO login, **except** the ones
listed in `excluded_hostnames` in `variables.tf` — those authenticate
themselves (registry's htpasswd, domain-api's `X-API-Key`, this
project's own MinIO state backend's SigV4 signing) and Access's
browser-redirect login flow would break any non-browser client hitting
them. Add a new hostname to `config.yml` and it's protected by default
the next time this applies; add it to `excluded_hostnames` instead if
it needs to stay open to non-browser clients.

State lives in this homelab's own MinIO (`infra/minio`, at
`minio-api.giomartins.dev`, bucket `tfstate`) — already deployed, no
setup needed on that side.

## One-time setup (dashboard/account steps only you can do)

These three are Cloudflare-account-specific — nothing here can be
automated without your own dashboard/account access.

1. **Cloudflare Account ID** — dashboard → any domain → right sidebar
   under "API" — or Account Home → right sidebar.

2. **Google identity provider ID** — Zero Trust dashboard → Settings →
   Authentication → click the existing Google provider → the ID is in
   the URL (`.../identity-providers/<this-part>`). Terraform can't
   create this provider itself (needs the Google OAuth client
   ID/secret exchange done once in the dashboard) — it only references
   an ID that must already exist.

3. **Access-scoped API token** — My Profile → API Tokens → Create
   Token → permission **Account / Access: Apps and Policies / Edit**,
   scoped to this account. This is a *different* token from the one
   `dns-sync.yml` uses (that one is Zone/DNS/Edit only — insufficient
   here).

## GitHub repo secrets

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCESS_API_TOKEN` | token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | from step 1 |
| `CLOUDFLARE_GOOGLE_IDP_ID` | from step 2 |
| `TF_STATE_S3_ENDPOINT` | `https://minio-api.giomartins.dev` |
| `TF_STATE_S3_ACCESS_KEY_ID` | MinIO service account access key (already created) |
| `TF_STATE_S3_SECRET_ACCESS_KEY` | MinIO service account secret key (already created) |

Once these are set, `.github/workflows/access-terraform.yml` plans on
every PR touching this directory or `config.yml`, and applies on push
to `main`.

## Running locally

```bash
export CLOUDFLARE_API_TOKEN=<token from step 3>
export AWS_ACCESS_KEY_ID=<MinIO access key>
export AWS_SECRET_ACCESS_KEY=<MinIO secret key>

cat > terraform.tfvars <<EOF
cloudflare_account_id           = "<from step 1>"
google_idp_identity_provider_id = "<from step 2>"
EOF

terraform init -backend-config="endpoints={s3=\"https://minio-api.giomartins.dev\"}"
terraform plan
terraform apply
```

`terraform.tfvars` is gitignored — it's account-specific, not something
to commit.
