"""Wiring: the composition root for the HTTP layer.

Kept apart from the routes so a test can build an app around a router with
a stubbed ``DomainApiPort`` and no configuration at all -- which is what
the component tests do, since they must not need a domain-api to exist.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from finance_api.application.commands import CommandRouter
from finance_api.infrastructure.domain_api import DomainApiClient


@dataclass(frozen=True, slots=True)
class Container:
    """Everything the routes need, already assembled."""

    router: CommandRouter
    api_keys: Mapping[str, str]


def build_container(
    *,
    domain_api_base_url: str,
    domain_api_key: str,
    api_keys: Mapping[str, str],
    timeout_s: float = 12.0,
) -> Container:
    client = DomainApiClient(
        base_url=domain_api_base_url,
        api_key=domain_api_key,
        timeout_s=timeout_s,
    )
    return Container(router=CommandRouter(client), api_keys=api_keys)


def build_container_with_router(
    router: CommandRouter, api_keys: Mapping[str, str]
) -> Container:
    """For tests: a real container around an injected router."""
    return Container(router=router, api_keys=api_keys)
