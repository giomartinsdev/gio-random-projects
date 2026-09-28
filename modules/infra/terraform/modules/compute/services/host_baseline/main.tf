# Host-level baseline the Docker provider can't express: the MTU on the
# VPS's NIC and the LOCAL iptables rules in front of every published port.
#
# Why this is a module and not manual steps: the Oracle Security List is a
# cloud layer nobody edits from inside the VM, but it is NOT enough on its
# own -- the instance's own iptables also has to allow each port, or a port
# open in the cloud still times out. Those local rules (and the NIC MTU,
# which Oracle images can ship wrong at 9000/jumbo) were applied by hand
# during tela's TURN setup; left that way they'd silently drift, and a
# rebuilt host would come back broken with no record of why. Encoding them
# here makes the host reproducible from the repo.
#
# How it reaches the host: the Docker provider talks to the remote dockerd
# over SSH, so the only command channel this config has is "run a
# container". A one-shot `--privileged --pid=host --net=host` container
# shares the host's network + mount namespaces, so its `iptables` IS the
# host's, and `nsenter -t 1` writes the netplan drop-in on the real root
# filesystem. Idempotent by construction: each rule/file is only written
# when absent, so re-running is a no-op.
resource "null_resource" "baseline" {
  count = var.enabled ? 1 : 0

  # Re-run only when the desired state actually changes.
  triggers = {
    interface = var.interface
    mtu       = var.interface != "" ? tostring(var.mtu) : ""
    rules     = join("\n", var.firewall_rules)
  }

  provisioner "local-exec" {
    environment = {
      DOCKER_HOST = var.docker_host
      IFACE       = var.interface
      MTU         = var.interface != "" ? tostring(var.mtu) : ""
      RULES       = join("\n", var.firewall_rules)
    }
    # All logic lives in the container so it runs on the host, not the CI
    # runner. `printf` (not echo) so the rule list keeps its newlines.
    command = <<-EOT
      docker run --rm --privileged --pid=host --net=host \
        -e IFACE="$IFACE" -e MTU="$MTU" -e RULES="$RULES" \
        alpine:3.20 sh -c '
        set -eu
        apk add --no-cache iptables >/dev/null 2>&1

        # MTU: runtime + a netplan drop-in so a reboot keeps it. The
        # drop-in (99-) sorts after cloud-init (50-), so it wins.
        if [ -n "$IFACE" ] && [ -n "$MTU" ]; then
          ip link set dev "$IFACE" mtu "$MTU"
          printf "network:\n  version: 2\n  ethernets:\n    %s:\n      mtu: %s\n" "$IFACE" "$MTU" \
            | nsenter -t 1 -m -- tee /etc/netplan/99-host-baseline-mtu.yaml >/dev/null
          nsenter -t 1 -m -- chmod 600 /etc/netplan/99-host-baseline-mtu.yaml
        fi

        # Firewall: ensure each rule exists exactly once. If it's missing,
        # insert it; then drop any duplicates an earlier manual/hand edit
        # left behind. Never removed before a replacement exists, so there's
        # no window where the port is closed.
        printf "%s\n" "$RULES" | while read -r proto ports; do
          [ -z "$proto" ] && continue
          iptables -C INPUT -p "$proto" --dport "$ports" -j ACCEPT 2>/dev/null \
            || iptables -I INPUT 1 -p "$proto" --dport "$ports" -j ACCEPT
          while [ "$(iptables -S INPUT | grep -c -- "-p $proto -m $proto --dport $ports -j ACCEPT")" -gt 1 ]; do
            iptables -D INPUT -p "$proto" --dport "$ports" -j ACCEPT
          done
        done

        # Survive reboot (netfilter-persistent is enabled on this image).
        nsenter -t 1 -m -n -- /usr/sbin/netfilter-persistent save >/dev/null 2>&1 || true
      '
    EOT
  }
}
