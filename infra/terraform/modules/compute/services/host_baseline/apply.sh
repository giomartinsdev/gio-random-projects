#!/bin/sh
# Runs INSIDE a one-shot privileged container on the VPS (host net+pid+mount
# namespaces), so `iptables`/`nsenter` act on the HOST. Not run directly.
#
# Receives base64-encoded IFACE_B64, MTU_B64 and RULES_B64 (newline-separated
# "{proto} {ports}") as environment variables -- base64 so the multi-line
# rule list crosses the shell/docker/ssh layers with no quoting to get wrong.
# Idempotent: settings already in place are left alone; duplicate firewall
# rules left by an earlier manual edit are reduced to one.
set -eu

IFACE=$(printf '%s' "${IFACE_B64:-}" | base64 -d)
MTU=$(printf '%s' "${MTU_B64:-}" | base64 -d)
RULES=$(printf '%s' "${RULES_B64:-}" | base64 -d)

apk add --no-cache iptables >/dev/null 2>&1

# MTU: runtime + a netplan drop-in so a reboot keeps it. The drop-in sorts
# after cloud-init's 50-, so it wins.
if [ -n "${IFACE:-}" ] && [ -n "${MTU:-}" ]; then
  ip link set dev "$IFACE" mtu "$MTU"
  printf 'network:\n  version: 2\n  ethernets:\n    %s:\n      mtu: %s\n' "$IFACE" "$MTU" \
    | nsenter -t 1 -m -- tee /etc/netplan/99-host-baseline-mtu.yaml >/dev/null
  nsenter -t 1 -m -- chmod 600 /etc/netplan/99-host-baseline-mtu.yaml
fi

# Firewall: ensure each rule exists exactly once. Insert when missing, then
# drop any duplicates -- never removing the last one, so there is no window
# where a port is closed.
printf '%s\n' "${RULES:-}" | while read -r proto ports; do
  [ -z "$proto" ] && continue
  iptables -C INPUT -p "$proto" --dport "$ports" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p "$proto" --dport "$ports" -j ACCEPT
  while [ "$(iptables -S INPUT | grep -c -- "-p $proto -m $proto --dport $ports -j ACCEPT")" -gt 1 ]; do
    iptables -D INPUT -p "$proto" --dport "$ports" -j ACCEPT
  done
done

# Survive reboot (netfilter-persistent is enabled on this image).
nsenter -t 1 -m -n -- /usr/sbin/netfilter-persistent save >/dev/null 2>&1 || true
