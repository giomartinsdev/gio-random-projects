# Terraform bootstrap

Creates the R2 bucket (`gio-homelab-tfstate`) that `modules/infra/terraform`'s
own state lives in. Separate from that config on purpose — it can't
depend on a bucket it's the one creating.

Run this **once**, locally, with local state (not remote — there's
nowhere durable for it to live yet, that's the whole problem this
solves). Not wired into CI for the same reason.

```bash
export CLOUDFLARE_API_TOKEN=<a token with Account / R2 / Edit>

cat > terraform.tfvars <<EOF
cloudflare_account_id = "<Cloudflare dashboard → Account Home → right sidebar>"
EOF

terraform init
terraform apply
```

After this succeeds, the bucket exists — go create the R2 API token
against it (`modules/infra/terraform/README.md` step 2) and configure
`modules/infra/terraform`'s backend with those credentials.

`terraform.tfstate` is gitignored. It only ever holds the bucket's name
and metadata (no secrets), but re-running this after losing it will
fail with "bucket already exists" — if that happens, `terraform import
cloudflare_r2_bucket.tfstate <account_id>/gio-homelab-tfstate` recovers
it rather than needing to delete/recreate the bucket (which would lose
whatever state was in it).
