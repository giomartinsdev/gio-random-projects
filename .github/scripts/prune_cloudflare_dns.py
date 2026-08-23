"""Deletes proxied CNAME records pointed at this tunnel that no longer have
a matching `hostname:` entry in the cloudflared ingress config — leftovers
from removed services that sync_cloudflare_dns.py never cleans up on its
own (it only upserts, see its own docstring for why).

Only touches CNAME records whose content is this tunnel's target
(`<TUNNEL_ID>.cfargotunnel.com`) — never touches unrelated DNS records in
the zone (MX, apex A/AAAA, other CNAMEs, etc).

This repo is public — logs from this script are too. Output is
deliberately terse (hostname + outcome only), matching sync_cloudflare_dns.py.

Usage: python3 prune_cloudflare_dns.py <path-to-cloudflared-config.yml>
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


def _extract_hostnames(config_path: str) -> set[str]:
    with open(config_path) as f:
        config = yaml.safe_load(f)
    return {entry["hostname"] for entry in config.get("ingress", []) if "hostname" in entry}


def _sanitized_error_detail(raw_body: bytes) -> str:
    try:
        parsed = json.loads(raw_body)
        messages = [e.get("message", "unknown error") for e in parsed.get("errors", [])]
        return "; ".join(messages) if messages else "unknown error"
    except (json.JSONDecodeError, AttributeError):
        return "unknown error (non-JSON response)"


def _request(method: str, path: str, token: str) -> dict[str, object]:
    request = urllib.request.Request(
        f"{API_BASE}{path}",
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
        detail = _sanitized_error_detail(error.read())
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error


def main() -> None:
    config_path = sys.argv[1]
    token = os.environ["CLOUDFLARE_API_TOKEN"]
    zone_id = os.environ["CLOUDFLARE_ZONE_ID"]
    tunnel_id = os.environ["TUNNEL_ID"]
    target = f"{tunnel_id}.cfargotunnel.com"

    live_hostnames = _extract_hostnames(config_path)

    records = _request("GET", f"/zones/{zone_id}/dns_records?type=CNAME&content={target}&per_page=100", token)
    results = records.get("result")
    if not isinstance(results, list):
        print("no CNAME records found pointing at this tunnel")
        return

    orphans = [r for r in results if r.get("name") not in live_hostnames]
    if not orphans:
        print("no orphaned DNS records — everything matches current ingress config")
        return

    failures = []
    for record in orphans:
        name = record.get("name")
        record_id = record.get("id")
        try:
            _request("DELETE", f"/zones/{zone_id}/dns_records/{record_id}", token)
            print(f"deleted  {name}")
        except Exception as error:  # noqa: BLE001 — report every failure, don't stop at the first
            print(f"FAILED   {name}: {error}")
            failures.append(name)

    if failures:
        print(f"\n{len(failures)} of {len(orphans)} deletion(s) failed: {', '.join(failures)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
