# module "compute/vaultwarden_bridge"

Internal-only secrets bridge — [Turbootzz/Vaultwarden-API](https://github.com/Turbootzz/Vaultwarden-API),
a small Go service that logs into `module.compute_vaultwarden`'s
Vaultwarden as a real account, syncs and decrypts the vault (actual
Bitwarden client-side crypto: PBKDF2/Argon2id key derivation +
AES-256-CBC-HMAC), and re-exposes individual items over a trivial
`GET /secret/:name` REST API. `domain-api`/`domain-worker` call this
instead of reimplementing Bitwarden's decryption themselves.

Not reachable outside the docker network — no `ports{}` block, no
tunnel ingress rule, no DNS record. Only containers on the same
network (`var.network_name`) can reach it, by name (`vaultwarden-api`,
port `8080`).

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
   `TF_VAULTWARDEN_API_CLIENT_ID`, `TF_VAULTWARDEN_API_CLIENT_SECRET`,
   and `TF_VAULTWARDEN_BRIDGE_API_KEY` (generate: `openssl rand -base64
   32`) as GH repo secrets — see the root README's secrets table.
4. In the vault, create one item per secret `domain-api`/
   `domain-worker` need, named exactly what the app looks up (e.g. an
   item named `DATABASE_URL` with that connection string in its
   password field, one named `DOMAIN_API_KEYS` the same way). The
   bridge matches by item name, case-insensitive.
5. `terraform apply`.

## A real caveat: two copies of the Postgres password

Terraform still sets Postgres's actual password directly
(`var.postgres_password`, via `module.compute_data`) — it has to,
since Terraform is what creates that user. The vault's own
`DATABASE_URL` item is a second, independent copy of that same
password, and nothing keeps them in sync automatically. Rotating
`postgres_password` means updating the vault item to match by hand, or
`domain-api`/`domain-worker` will fail to connect with a stale
password until you do.
