"""Entry point: env wire-up + the shared loop.

Writes go through domain-api's POST /deals (command pipeline: the
Go worker persists to raw_deals and emits deal.created; the
events-announcer announces from there -- this worker has no database
and no webhook). Polls every POLL_SECONDS (terraform module passes
1800).
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime

from deals_common.deals_api import DealsClient
from deals_common.fetch import HttpClient
from deals_common import telemetry
from deals_common.runner import run_worker

from .client import fetch_recent, to_raw

PAGES_PER_CYCLE = 1  # 20 deals/page; recency beats depth for a poller

REQUIRED = ("DOMAIN_API_URL", "DOMAIN_API_KEY", "SOURCE_BASE_URL")

log = logging.getLogger("pld-scraper")


def main() -> int:
    missing = [required for required in REQUIRED if not os.environ.get(required)]
    if missing:
        raise SystemExit(f"missing required env: {', '.join(missing)}")

    # One client for the process's lifetime: a cf_clearance won from a
    # challenge must survive across cycles (each HttpClient would
    # otherwise re-solve from scratch every poll).
    http = HttpClient(flaresolverr_url=os.environ.get("FLARESOLVERR_URL", ""))

    def load_deals() -> list:
        raw = []
        for deal in fetch_recent(http, pages=PAGES_PER_CYCLE):
            mapped = to_raw(deal, datetime.now(tz=UTC))
            if mapped is not None:
                raw.append(mapped)
            else:
                log.debug("skipped non-active/incomplete deal id=%s", deal.get("id"))
        return raw

    shutdown = telemetry.init("pld-scraper")
    try:
        telemetry.configure_logging(getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO))
        run_worker(
            "pld-scraper",
            load_deals=load_deals,
            push=DealsClient.from_env().push_deals,
        )
    finally:
        shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())