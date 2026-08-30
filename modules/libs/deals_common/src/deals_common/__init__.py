"""Shared contract + helpers for the deals workers.

Every source worker (pld-scraper, phb-scraper, ...) turns its source's
JSON into a RawDeal and hands it to DealsClient.push_deals -- that is
the whole integration surface: domain-api's command pipeline persists
the deal and emits its deal.created event; the events-announcer worker
consumes those events off domain.events.queue. Nothing in this lib
touches Postgres or Discord directly anymore.
"""

from .deals_api import DealsClient, PushResult
from .fetch import HttpClient
from .model import RawDeal
from .runner import run_worker

__all__ = [
    "RawDeal",
    "HttpClient",
    "DealsClient",
    "PushResult",
    "run_worker",
]