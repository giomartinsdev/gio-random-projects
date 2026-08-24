# module "compute/vaultwarden"

Self-hosted password manager — [Vaultwarden](https://github.com/dani-garcia/vaultwarden),
an unofficial Bitwarden-compatible server. Single container, speaks
the real Bitwarden API (official browser extensions/mobile apps work
against it unmodified) and serves the full Bitwarden web vault GUI
itself at `https://vault.giomartins.dev` — no separate frontend
container, unlike the official multi-service Bitwarden self-host
stack.

- **`vaultwarden`** — `vaultwarden/server:latest`, all data (the
  encrypted vault, attachments, config) on the `vaultwarden_data`
  volume. Published on `var.published_port` (default `8222`); the root
  module's `locals.tf` ingress rule for `vault.giomartins.dev` must
  point at the same port.

## Access

`vault.giomartins.dev` is not in `excluded_hostnames`, so it gets the
same Google-SSO Cloudflare Access application every other
browser-facing hostname does — reaching Vaultwarden's own login page
at all requires a `var.allowed_emails` Google account first.
`SIGNUPS_ALLOWED=true` is safe specifically because of that outer
gate: nothing wider than `allowed_emails` can ever reach the signup
form. `/admin` (user management, org config, diagnostics) is gated a
second time, independently, by `var.admin_token`.

## First-time setup

1. `terraform apply` with a real `vaultwarden_admin_token` set
   (`openssl rand -base64 48`).
2. Visit `https://vault.giomartins.dev`, log in through Access, then
   create the one real account through Vaultwarden's own signup form.
3. Optionally flip `SIGNUPS_ALLOWED` to `false` afterward and re-apply
   — not required for security (Access already restricts who can
   reach the form), only to stop Vaultwarden's own UI from offering a
   "create account" link once there's no reason to use it again.
4. `https://vault.giomartins.dev/admin`, token from step 1, for
   anything beyond a single user's own vault.

## Backups

`vaultwarden_data` is the entire vault — back up the volume
(`docker run --rm -v vaultwarden_data:/data -v $(pwd):/backup alpine
tar czf /backup/vaultwarden-backup.tgz /data`, or equivalent) the same
way you'd back up any credential store, on whatever schedule and
retention that implies for this homelab.
