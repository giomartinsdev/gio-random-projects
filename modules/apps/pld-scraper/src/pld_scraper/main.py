"""Entry point: env wire-up + the shared loop.

Self-migrates raw_deals on boot; polls every POLL_SECONDS (terraform
module passes 1800); announces INSERTED deals when
DISCORD_DEALS_WEBHOOK_URL is set (blank = silent collection).
"""

from __future__ import annotations

import logging
import os

from deals_common.db import utcnow
from deals_common.fetch import HttpClient
from deals_common.runner import run_worker

from .client import fetch_recent, to_raw

PAGES_PER_CYCLE = 1  # 20 deals/page; recency beats depth for a poller

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("pld-scraper")


def load_deals() -> list:
    http = HttpClient()
    raw = []
    for deal in fetch_recent(http, pages=PAGES_PER_CYCLE):
        mapped = to_raw(deal, utcnow())
        if mapped is not None:
            raw.append(mapped)
        else:
            log.debug("skipped non-active/incomplete deal id=%s", deal.get("id"))
    return raw


def main() -> None:
    for required in ("DATABASE_URL", "SOURCE_BASE_URL"):
        if not os.environ.get(required):
            raise SystemExit(f"{required} is required")
    run_worker(
        "pld-scraper",
        load_deals=load_deals,
        database_url=os.environ["DATABASE_URL"],
        webhook_url=os.environ.get("DISCORD_DEALS_WEBHOOK_URL") or None,
    )


if __name__ == "__main__":
    main()