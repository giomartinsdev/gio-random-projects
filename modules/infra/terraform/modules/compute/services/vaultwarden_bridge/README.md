# module "compute/vaultwarden_bridge"

Internal-only secrets bridge — [Turbootzz/Vaultwarden-API](https://github.com/Turbootzz/Vaultwarden-API),
a small Go service that logs into `module.compute_vaultwarden`'s
Vaultwarden as a real account, syncs and decrypts the vault (actual
Bitwarden client-side crypto: PBKDF2/Argon2id key derivation +
AES-256-CBC-HMAC), and re-exposes individual items over a trivial
`GET /secret/:name` REST API. `domain-api`/`domain-worker` call this
instead of reimplementing Bitwarden's decryption themselves.

Not reachable outside the docker network — no `ports{}` block, no
public port, no DNS record. Only containers on the same
network (`var.network_name`) can reach it, by name (`vaultwarden-api`,
port `8080`).

## Image: built by us, not pulled from ghcr.io/turbootzz directly

`ghcr.io/turbootzz/vaultwarden-api`'s own multi-arch manifest is
broken upstream: their `Dockerfile` has `ARG TARGETARCH=amd64` with a
hardcoded default that their own CI never actually overrides per
platform, so every tag in the manifest list — including the one
labeled `arm64` — contains the literal same amd64 binary (confirmed by
reading the raw ELF header, not just inferred from a crash). Running
it on the VPS needs x86-64 emulation as a result, which conflicts at
the kernel level with `box64` (see `docs/servidor-zomboid.md` — both
box64 and QEMU register for the exact same binfmt_misc magic/mask, and
only one can be active on the whole host at a time; the Zomboid server
needs box64, so QEMU can't stay registered just for this).

`var.registry_host`'s `vaultwarden-api` image is instead Turbootzz/
Vaultwarden-API's own source, built natively on the VPS's own arm64
(no cross-compilation, no emulation of any kind needed) and pushed
under the same name. To rebuild after upstream cuts a new release:

```bash
ssh ubuntu@<server_ip>
rm -rf /tmp/vaultwarden-api-build
git clone --depth 1 https://github.com/Turbootzz/Vaultwarden-API.git /tmp/vaultwarden-api-build
cd /tmp/vaultwarden-api-build
docker build --build-arg TARGETARCH=arm64 -t registry.giomartins.dev:5000/vaultwarden-api:latest .
docker push registry.giomartins.dev:5000/vaultwarden-api:latest
terraform apply -replace=module.compute_services_vaultwarden_bridge[0].docker_container.vaultwarden_bridge
```

## Why a bootstrap credential is unavoidable

Bitwarden's end-to-end encryption means there's no way to fetch a
decrypted item without something that can derive the decryption key —
an API key alone isn't enough; the master password (or an already-
derived key from it) is required regardless. So this module still
needs real secrets from Terraform: the Vaultwarden account's email +
master password (+ optionally an API key client_id/secret, recommended
to skip 2FA prompts on every restart). Those four don't move into the
vault themselves — they're the "secret zero" that unlocks everything
else.

## First-time setup (in order)

1. Create your real Vaultwarden account through `vault.giomartins.dev`'s
   signup form first — see `modules/compute/vaultwarden`'s README.
   This module can't do anything until that account exists.
2. In the vault, go to Account Settings → Security → Keys, view/rotate
   your API key to get a `client_id` and `client_secret`.
3. Set `TF_VAULTWARDEN_ACCOUNT_EMAIL`, `TF_VAULTWARDEN_ACCOUNT_PASSWORD`,
   `TF_VAULTWARDEN_API_CLIENT_ID`, and `TF_VAULTWARDEN_API_CLIENT_SECRET`
   as GH repo secrets — see the root README's secrets table. (The
   bridge's own `bridge_api_key`, and the `DATABASE_URL`/
   `DOMAIN_API_KEYS` items themselves, are Terraform-generated and
   -seeded now — see `../../secrets.tf` and `scripts/seed_vault.sh` —
   nothing left to create by hand.)
4. `terraform apply`.

## Keeping the Postgres password and the vault's copy in sync

`../../secrets.tf` generates `postgres_password` with Terraform itself
now (`random_password.postgres`) instead of taking it as an input, and
two `null_resource`s keep everything in sync on every apply that
changes it: one runs `ALTER USER` directly against the live Postgres
(the env var alone only takes effect on a fresh, empty data volume),
the other (`scripts/seed_vault.sh`) pushes the matching `DATABASE_URL`
item into this vault over the internal docker network. Both only fire
when the generated password actually changes.
