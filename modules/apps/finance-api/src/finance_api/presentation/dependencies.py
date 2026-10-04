"""Wiring: the composition root for the HTTP layer.

Kept apart from the routes so a test can build an app around a router with
a stubbed ``DomainApiPort`` and no configuration at all -- which is what
the component tests do, since they must not need a domain-api to exist.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from finance_api.application.commands import CommandRouter
from finance_api.application.reads import QueryRouter
from finance_api.infrastructure.domain_api import DomainApiClient


@dataclass(frozen=True, slots=True)
class Container:
    """Everything the routes need, already assembled.

    ``queries`` is optional so the write-only component tests can build a
    container around a ``CommandRouter`` alone; a read route reached without
    it is a 500 (wiring bug), not a silent empty answer.
    """

    router: CommandRouter
    api_keys: Mapping[str, str]
    queries: QueryRouter | None = None


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
    return Container(
        router=CommandRouter(client),
        api_keys=api_keys,
        queries=QueryRouter(client),
    )


def build_container_with_router(
    router: CommandRouter,
    api_keys: Mapping[str, str],
    *,
    queries: QueryRouter | None = None,
) -> Container:
    """For tests: a real container around an injected router."""
    return Container(router=router, api_keys=api_keys, queries=queries)
