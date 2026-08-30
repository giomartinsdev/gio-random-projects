"""The worker loop every scraper shares -- post-api's announcer
interval pattern, in Python: run now, announce what landed, sleep at
POLL_SECONDS with a little jitter, never let one bad cycle kill the
process.
"""

from __future__ import annotations

import logging
import os
import random
import signal
import threading
import time
from collections.abc import Callable

from .db import ensure_schema, upsert_deals
from .discord import announce
from .model import RawDeal

log = logging.getLogger(__name__)

DEFAULT_POLL_SECONDS = 1800
JITTER_FRACTION = 0.1  # ±10% so pollers from different containers desync


def run_worker(
    name: str,
    *,
    load_deals: Callable[[], list[RawDeal]],
    database_url: str,
    webhook_url: str | None = None,
    poll_seconds: int | None = None,
) -> None:
    """Keep fetching -> storing -> announcing until SIGTERM.

    `load_deals` does the source-specific part (endpoint + mapping) and
    may raise; the loop logs and moves on. Everything else is generic.
    """
    poll = poll_seconds or int(os.environ.get("POLL_SECONDS", str(DEFAULT_POLL_SECONDS)))

    running = threading.Event()
    running.set()

    def _stop(_sig, _frame) -> None:
        running.clear()

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, _stop)

    ensure_schema(database_url)
    log.info("%s up: poll every %ds, discord=%s", name, poll, "on" if webhook_url else "off")

    while running.is_set():
        started = time.monotonic()
        try:
            deals = load_deals()
            fresh = upsert_deals(database_url, deals) if deals else []
            sent = announce(webhook_url, fresh) if webhook_url and fresh else 0
            log.info(
                "cycle done in %.1fs: %d seen, %d new, %d announced",
                time.monotonic() - started,
                len(deals),
                len(fresh),
                sent,
            )
        except Exception:
            log.exception("cycle failed; retrying after the poll interval")

        # Sleep in short slices so a SIGTERM lands in seconds.
        target = poll * (1 + random.uniform(-JITTER_FRACTION, JITTER_FRACTION))
        slept = 0.0
        while running.is_set() and slept < target:
            slept += 5.0 if running.wait(min(5.0, target - slept)) else target
    log.info("%s stopping", name)