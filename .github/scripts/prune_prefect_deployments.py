"""Deletes any Prefect deployment that no longer has a matching entry in
prefect.yaml.

`prefect deploy --all` is additive/update-only — it creates or updates
every deployment listed in prefect.yaml, but has no `--prune` flag (none
exists on this Prefect version) to remove one that was dropped from the
file. Left alone, deleting a flow from the repo (and its entry from
prefect.yaml) leaves its old deployment running on its schedule forever,
failing every run once the flow's code is gone from the branch it clones.

Usage: python3 prune_prefect_deployments.py <path-to-prefect.yaml>
Env: PREFECT_API_URL, PREFECT_CLIENT_CUSTOM_HEADERS — same as `prefect
deploy` itself, see flows-ci.yml's deploy job.
"""

from __future__ import annotations

import asyncio
import sys

import yaml
from prefect.client.orchestration import get_client


def _expected_names(prefect_yaml_path: str) -> set[str]:
    with open(prefect_yaml_path) as f:
        config = yaml.safe_load(f)
    return {entry["name"] for entry in config.get("deployments", []) if "name" in entry}


async def _prune(prefect_yaml_path: str) -> None:
    expected = _expected_names(prefect_yaml_path)

    async with get_client() as client:
        deployments = await client.read_deployments()
        stale = [d for d in deployments if d.name not in expected]

        if not stale:
            print("no orphaned deployments found")
            return

        flows = {flow.id: flow for flow in await client.read_flows()}
        for deployment in stale:
            flow_name = flows[deployment.flow_id].name if deployment.flow_id in flows else "?"
            print(f"deleting orphaned deployment: {flow_name}/{deployment.name}")
            await client.delete_deployment(deployment.id)


if __name__ == "__main__":
    asyncio.run(_prune(sys.argv[1]))
