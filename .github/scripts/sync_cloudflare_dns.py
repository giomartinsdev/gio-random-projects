"""Upserts a proxied CNAME for every `hostname:` in a cloudflared ingress
config, pointed at this tunnel — via the Cloudflare API directly, so this
never depends on a cert.pem living on some server's filesystem (see
dns-sync.yml's header comment for why that mattered).

Usage: python3 sync_cloudflare_dns.py <path-to-cloudflared-config.yml>
Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, TUNNEL_ID
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

import yaml

API_BASE = "https://api.cloudflare.com/client/v4"


def _extract_hostnames(config_path: str) -> list[str]:
    with open(config_path) as f:
        config = yaml.safe_load(f)
    return [entry["hostname"] for entry in config.get("ingress", []) if "hostname" in entry]


def _request(method: str, path: str, token: str, payload: dict[str, object] | None = None) -> dict[str, object]:
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f"{API_BASE}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        details = error.read().decode()
        raise RuntimeError(f"{method} {path} failed: {error.code} {details}") from error


def _upsert(hostname: str, target: str, zone_id: str, token: str) -> None:
    existing = _request("GET", f"/zones/{zone_id}/dns_records?type=CNAME&name={hostname}", token)
    results = existing.get("result")
    record_id = results[0]["id"] if isinstance(results, list) and results else None

    payload = {"type": "CNAME", "name": hostname, "content": target, "proxied": True, "ttl": 1}

    if record_id:
        _request("PUT", f"/zones/{zone_id}/dns_records/{record_id}", token, payload)
        print(f"updated  {hostname} -> {target}")
    else:
        _request("POST", f"/zones/{zone_id}/dns_records", token, payload)
        print(f"created  {hostname} -> {target}")


def main() -> None:
    config_path = sys.argv[1]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    tunnel_id = os.environ["TUNNEL_ID"]
    target = f"{tunnel_id}.cfargotunnel.com"

    hostnames = _extract_hostnames(config_path)
    if not hostnames:
        print("no hostnames found in ingress config — nothing to do")
        return

    failures = []
    for hostname in hostnames:
        try:
            _upsert(hostname, target, zone_id, token)
        except Exception as error:  # noqa: BLE001 — report every failure, don't stop at the first
            print(f"FAILED   {hostname}: {error}")
            failures.append(hostname)

    if failures:
        print(f"\n{len(failures)} of {len(hostnames)} hostname(s) failed: {', '.join(failures)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
