# Terraform bootstrap

Everything that `modules/infra/terraform` (the CI-driven config) can't
manage itself, because it's what makes that config work in the first
place:

- **`cloudflare_r2_bucket.tfstate`** — the R2 bucket
  (`gio-homelab-tfstate`) both this config's own state *would* live in
  and `modules/infra/terraform`'s does. Can't depend on a bucket it's
  the one creating.
- **`cloudflare_api_token.bootstrap`** — the token this config's own
  `cloudflare` provider authenticates with on every run after the
  first. Scoped to exactly `cloudflare_r2_bucket.tfstate`'s own need
  (Account / R2 / Edit), nothing broader — see "Bootstrapping the API
  token" below for why a token that authenticates the provider that
  creates it needs a one-time workaround.

That's the whole config now. It used to also run `cloudflared`, a
docker-api-proxy, and a beszel-proxy — all workarounds for reaching
the home server's dockerd through the Cloudflare Tunnel. The VPS
migration removed the tunnel and every proxy: Terraform talks to
dockerd over plain SSH, so there is nothing left here to bootstrap
beyond the bucket and the token.

Run **by hand only**, with **local state** — never wired into CI:
there's nowhere durable for the bucket bootstrap's state to live
before the bucket exists.

## Running it

```bash
export CLOUDFLARE_API_TOKEN=<see "Bootstrapping the API token">
terraform init
terraform plan
terraform apply
```

## Bootstrapping the API token

The chicken-and-egg: this config creates
`cloudflare_api_token.bootstrap`, but its own provider needs *some*
credential to run at all. The one-time workaround is a broader
credential used exactly once:

```bash
# Global API Key — dashboard → My Profile → API Tokens → API Keys →
# Global API Key → View. Broader than anything this config needs;
# only for this one bootstrap apply, never stored or reused after.
export CLOUDFLARE_API_KEY=<...>
export CLOUDFLARE_EMAIL=<account email>

terraform apply

# From then on, the generated token is all any run needs:
terraform output bootstrap_api_token   # copy somewhere safe
unset CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
export CLOUDFLARE_API_TOKEN=<the output above>
```

## Recovering from a lost bootstrap state

If `terraform.tfstate` is lost, don't re-apply against the live
resources — import them instead (resource addresses:
`cloudflare_r2_bucket.tfstate`, `cloudflare_api_token.bootstrap`;
lookup IDs in the dashboard). The API token can't be read back after
creation though — if the token value itself is lost with the state,
delete it in the dashboard and let a fresh apply create a new one,
then update `CLOUDFLARE_API_TOKEN` everywhere it's used.
