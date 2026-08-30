"""Shared contract + helpers for the deals scrapers.

Every source worker (pld-scraper, phb-scraper, ...) turns its source's
JSON into a RawDeal and hands it to db.upsert_deals -- that is the
whole integration surface. The dedupe/score engine later reads
raw_deals, never the workers.
"""

from .db import ensure_schema, upsert_deals
from .discord import announce
from .fetch import HttpClient
from .model import RawDeal
from .runner import run_worker

__all__ = [
    "RawDeal",
    "HttpClient",
    "ensure_schema",
    "upsert_deals",
    "announce",
    "run_worker",
]