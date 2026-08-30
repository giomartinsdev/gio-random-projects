"""Shared contract + helpers for the deals workers.

Every source worker (pld-scraper, phb-scraper, ...) turns its source's
JSON into a RawDeal and hands it to DealsClient.push_deals -- that is
the whole integration surface: domain-api's command pipeline persists
the deal and emits its deal.created event; the events-announcer worker
consumes those events off domain.events.queue. Nothing in this lib
touches Postgres or Discord directly anymore.
"""

from .deals_api import DealsClient, PushResult
from .model import RawDeal
from .runner import run_worker


def __getattr__(name):
    # fetch.HttpClient drags in scrapling/curl_cffi — deps this package
    # deliberately does not declare (see pyproject.toml: the consuming
    # scrapers list them instead). Resolving it lazily keeps every other
    # import path (the events-announcer's announce/telemetry among them)
    # usable from an env that has only redis + this package.
    if name == "HttpClient":
        from .fetch import HttpClient

        return HttpClient
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "RawDeal",
    "HttpClient",
    "DealsClient",
    "PushResult",
    "run_worker",
]