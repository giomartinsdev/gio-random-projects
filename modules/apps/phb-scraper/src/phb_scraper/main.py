"""Entry point: env wire-up + the shared loop.

Same shape as the other scraper's main -- the only differences are the
source client and the log name. Self-migrates raw_deals on boot; polls
every POLL_SECONDS; announces INSERTED deals when
DISCORD_DEALS_WEBHOOK_URL is set.
"""

from __future__ import annotations

import logging
import os

from deals_common.db import utcnow
from deals_common.fetch import HttpClient
from deals_common.runner import run_worker

from .client import fetch_recent, to_raw

MAX_PAGES_PER_CYCLE = 3  # 10 offers/page

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("phb-scraper")


def load_deals() -> list:
    http = HttpClient()
    raw = []
    for offer in fetch_recent(http, max_pages=MAX_PAGES_PER_CYCLE):
        mapped = to_raw(offer, utcnow())
        if mapped is not None:
            raw.append(mapped)
        else:
            log.debug("skipped non-active/incomplete offer id=%s", offer.get("id"))
    return raw


def main() -> None:
    for required in ("DATABASE_URL", "SOURCE_BASE_URL"):
        if not os.environ.get(required):
            raise SystemExit(f"{required} is required")
    run_worker(
        "phb-scraper",
        load_deals=load_deals,
        database_url=os.environ["DATABASE_URL"],
        webhook_url=os.environ.get("DISCORD_DEALS_WEBHOOK_URL") or None,
    )


if __name__ == "__main__":
    main()