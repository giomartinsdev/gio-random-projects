# host_baseline

Host-level settings the Docker provider can't express, applied over the
same SSH channel it already uses: the NIC **MTU** and the **local iptables
rules** in front of every published port.

## Why this exists

The Oracle **Security List** is a cloud layer nobody can edit from inside
the VM. It is necessary but **not sufficient**: the instance's own iptables
also has to allow a port, or a port that is open in the cloud still times
out. During tela's TURN setup those local rules (and the NIC MTU, which
Oracle images can ship wrong at 9000/jumbo — the internet path silently
drops large packets) were applied by hand. Left that way they drift, and a
rebuilt host comes back broken with no record of why. Encoding them here
makes the host reproducible from the repo.

## How it reaches the host

The Docker provider talks to the remote dockerd over SSH, so this config's
only command channel is "run a container". `main.tf` runs a one-shot
`alpine` container with `--privileged --pid=host --net=host`, which shares
the host's network + mount + PID namespaces — its `iptables` **is** the
host's, and `nsenter -t 1 -m` writes files on the real root filesystem.
`apply.sh` is passed in as base64 (with its parameters) so a multi-line
rule list crosses the shell → docker → ssh layers with no quoting to get
wrong.

## Idempotence

- A firewall rule already present is left alone; a missing one is
  inserted; duplicates left by an earlier manual edit are reduced to one
  (never removing the last, so a port is never momentarily closed).
- The MTU is set at runtime and written to a netplan drop-in
  (`99-host-baseline-mtu.yaml`, sorts after cloud-init's `50-`).
- `netfilter-persistent save` runs so both survive a reboot.
- Re-runs are no-ops; the resource only re-runs when `interface`, `mtu`,
  or the rule list actually change.

## Inputs

| Name | Default | Meaning |
|---|---|---|
| `docker_host` | — | `ssh://user@host` the docker provider uses. |
| `enabled` | `true` | Turn the whole module into a no-op. |
| `interface` | `enp0s6` | NIC to pin the MTU on. Empty skips the MTU step. |
| `mtu` | `1500` | Standard Ethernet; correct for a public-internet host. |
| `firewall_rules` | `[]` | `"{proto} {port\|first:last}"`, e.g. `"udp 3478"`. |

## What it does NOT do

It does not touch the Oracle **Security List** (a cloud-side resource, not
reachable from inside the VM). Any new inbound port needs **both**: a rule
here and a Security List entry — the latter by hand, in the Oracle console.
