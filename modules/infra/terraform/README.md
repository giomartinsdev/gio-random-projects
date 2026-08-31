# Terraform

Source of truth for Cloudflare (DNS, Access, registry mTLS) **and** for
the VPS's core containers (postgres, redis, minio, the APIs, the front,
and every service module). This root module wires up provider
configuration (`versions.tf`, the only place `provider` blocks live)
and its child modules; it declares no resources of its own beyond
that. `locals.tf`'s `services` list is the one place a new
hostname/port pair gets declared — everything else derives from it:

- **[`modules/cloud/cloudflare`](modules/cloud/cloudflare/README.md)** —
  one A record per hostname, orange-cloud through Cloudflare's proxy
  except registry.giomartins.dev (grey — its :5000 docker protocol
  can't transit the proxy), Access applications/policies/service
  tokens for everything not in `excluded_hostnames`, and
  registry.giomartins.dev's mTLS chain + WAF enforcement rule (dormant
  while its record stays grey — see that file).
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
  (+bridge), adminer,
  [`observability`](modules/compute/services/observability/README.md)
  (grafana + loki + prometheus + tempo + alloy: logs, metrics, traces
  for everything else here),
  [`flaresolverr`](modules/compute/services/flaresolverr/README.md)
  (idle-until-needed Cloudflare-challenge solver for the deals
  scrapers), and
  [`ingress`](modules/compute/services/ingress/README.md)
  — the single nginx front door everything else routes through.

## Where the traffic goes

Phase 2 (current): every DNS record is **orange-cloud through
Cloudflare's proxy**, except `registry.giomartins.dev` (grey — CI's
`docker push` and watchtower's pulls speak plain HTTP to its `:5000`,
and 5000 isn't a port Cloudflare proxies; see
`modules/cloud/cloudflare/locals.tf`). Browser traffic gets real TLS at
Cloudflare's edge, which forwards to the VPS over HTTP :80 —
`modules/compute/services/ingress`, a single `nginx` on the host
network routing by `Host` header to `127.0.0.1:<port>` for every entry
in `locals.tf`'s `services` list. Every app/service container's own
published port is bound to `127.0.0.1` only, so the edge + ingress pair
is the only way in from outside (the registry's `:5000` and tela's UDP
media port are the direct-to-the-box exceptions). The docker provider
itself connects to dockerd over plain SSH (`ssh://`), so there's no
exposed Docker API endpoint either. The Project Zomboid game server
also opens UDP 16261-16262 directly on the host — it's not a container
here at all (arm64 box, x86-only game: runs natively via box64 under a
systemd service installed by github.com/kaanzapkinus/zomboid-b42-on-arm;
see root `main.tf`'s note).
`var.server_ip` has no default — every CI run discovers it fresh by
SSHing into the VPS and asking an external IP-echo service, so the DNS
records stay correct even if the VPS's address ever changes (see each
workflow's "Discover the VPS's public IP" step).

The edge layers arm automatically with the flip: hostnames not in
`excluded_hostnames` sit behind Cloudflare Access (Google SSO for
humans; per-hostname service tokens — seeded into Vaultwarden — for
machines), and registry's mTLS WAF rule stays dormant as long as its
record stays grey.

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

8. **`/root/.docker` must exist on the VPS** — created automatically on
   any modern distro, but verify if `docker_config_install` complains;
   Docker bind mounts don't create their host-side source path
   themselves.

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
| `TF_BESZEL_AGENT_KEY` | the Beszel hub's SSH public key — blank is fine until the hub's first boot; see `modules/compute/services/monitoring`'s README for how to get it |
| `TF_VAULTWARDEN_ACCOUNT_EMAIL` | email of your real Vaultwarden account (create it first, through the UI) — blank is fine until then; see `modules/compute/services/vaultwarden_bridge`'s README |
| `TF_VAULTWARDEN_ACCOUNT_PASSWORD` | that account's master password |
| `TF_VAULTWARDEN_API_CLIENT_ID` | API key `client_id` from the vault UI → Account Settings → Security → Keys |
| `TF_VAULTWARDEN_API_CLIENT_SECRET` | matching `client_secret` |

`registry_password` and `discord_client_id`/`discord_client_secret`
are deliberately **not** GitHub secrets — every workflow's "Fetch
secrets from Vaultwarden" step reads them from the vault instead
(secrets.tf's `"registry"` and `"discord"` vault_seed groups keep
those items current on every apply; `scripts/fetch_vault_secret.sh` is
the read side). One consequence: a true from-scratch bootstrap (empty
Vaultwarden, nothing seeded yet) has nothing for that step to fetch —
run the very first `terraform apply` locally instead, with
`registry_password`/`discord_client_id`/`discord_client_secret` set in
`terraform.tfvars` (see "Running locally" below), and CI's
vault-fetch-based flow takes back over for every apply after that one
seeds the vault.

The deals scrapers (python-ci-cd.yml) extend that pattern with inputs
nobody generates: their per-source feed URLs, `TF_VAR_pld_source_url`
and `TF_VAR_phb_source_url`, live in vault items **`PLD_SOURCE_URL`
and `PHB_SOURCE_URL`** which have to be created by hand — both
workflows (`tf-ci-cd.yml` too, which needs them at apply time or a
tf-only apply would write blanks over the scrapers' env) hard-fail
until they exist, by design (a blank `SOURCE_BASE_URL` makes the
worker refuse to boot, which is worse than a red deploy). The repo
itself ships no scraped-site hostnames anywhere on purpose; the
workers only ever see the URL through that env. The optional
**`DEALS_DISCORD_WEBHOOK_URL`** item (blank = the events-announcer
keeps draining the event queue silently) bootstraps like
`DISCORD_ANNOUNCE_WEBHOOK_URL` does.

The deals stack itself is fully wired by Terraform: scrapers push
through domain-api with `random_id.deals_domain_key` (secrets.tf,
`:deals-scrapers` in the API-key list), and the whole data path is
scraper → `POST /deals` → domain-worker (owner of the `raw_deals`
table) → `domain.events.queue` → events-announcer → Discord. When a
source's edge answers a poll with Cloudflare's JS challenge, the
scraper's fetch layer hands that URL to the flaresolverr container
(same root module, `flaresolverr_url`) once and reuses the clearance —
no extra vault item or workflow input involved.

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
server_ip                       = "<the VPS's current public IP>"
docker_host                     = "ssh://ubuntu@<the VPS's public IP>"
registry_password               = "<openssl rand -base64 24, or the existing one from the vault's REGISTRY_PASSWORD item>"
# Only needed on a true from-scratch bootstrap -- CI fetches both of
# these from Vaultwarden once this apply has seeded it (see the
# GitHub repo secrets section above). Blank disables Discord entirely.
discord_client_id               = ""
discord_client_secret           = ""
# Deals scrapers: from-scratch bootstraps set the source URLs here if
# the vault items don't exist yet (otherwise those workers refuse to
# boot); CI fetches them from Vaultwarden after that. The webhook is
# optional forever -- blank = the workers collect without announcing.
pld_source_url                  = ""
phb_source_url                  = ""
deals_discord_webhook_url       = ""
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
