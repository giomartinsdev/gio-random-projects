"""Entry point: env wire-up + the shared loop.

Same shape as the other scraper's main -- the only differences are the
source client and the log name. Writes go through domain-api's POST
/deals (this worker has no database and no webhook; the Go worker
persists raw_deals and the events-announcer announces). Polls every
POLL_SECONDS.
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

MAX_PAGES_PER_CYCLE = 3  # 10 offers/page

REQUIRED = ("DOMAIN_API_URL", "DOMAIN_API_KEY", "SOURCE_BASE_URL")

log = logging.getLogger("phb-scraper")


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
        for offer in fetch_recent(http, max_pages=MAX_PAGES_PER_CYCLE):
            mapped = to_raw(offer, datetime.now(tz=UTC))
            if mapped is not None:
                raw.append(mapped)
            else:
                log.debug("skipped non-active/incomplete offer id=%s", offer.get("id"))
        return raw

    shutdown = telemetry.init("phb-scraper")
    try:
        telemetry.configure_logging(getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO))
        run_worker(
            "phb-scraper",
            load_deals=load_deals,
            push=DealsClient.from_env().push_deals,
        )
    finally:
        shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())