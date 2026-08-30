"""The worker loop every scraper shares: scrape now, push through
domain-api, sleep at POLL_SECONDS with a little jitter, never let one
bad cycle kill the process.

No database and no webhook here anymore -- persistence is
DealsClient.push_deals (domain-api's command pipeline), announcing
happens downstream in the events-announcer worker reading
domain.events.queue. This loop only owns cadence + telemetry: one
"scrape cycle" span per pass so a POST /deals in Tempo nests under the
cycle that produced it, and the cycle counters the dashboard reads.
"""

from __future__ import annotations

import logging
import os
import random
import signal
import threading
import time
from collections.abc import Callable

from . import telemetry
from .model import RawDeal

log = logging.getLogger(__name__)

DEFAULT_POLL_SECONDS = 1800
JITTER_FRACTION = 0.1  # ±10% so pollers from different containers desync


def run_worker(
    name: str,
    *,
    load_deals: Callable[[], list[RawDeal]],
    push: Callable[[list[RawDeal]], object],
    poll_seconds: int | None = None,
) -> None:
    """Keep fetching -> pushing until SIGTERM.

    `load_deals` does the source-specific part (endpoint + mapping) and
    may raise; the loop logs and moves on. `push` is the write path
    (normally a bound DealsClient.push_deals); it is expected to
    account for per-deal outcomes inside itself -- a push failure never
    discards the cycle, those deals just ride to the next poll.
    """
    poll = poll_seconds or int(os.environ.get("POLL_SECONDS", str(DEFAULT_POLL_SECONDS)))

    # Instruments are created here (post-telemetry-init, at run time)
    # because module level would bind them to no-op meters before any
    # main() gets to call telemetry.init().
    cycles = telemetry.counter("deals_cycles_total", description="Scrape cycles, by outcome")
    duration = telemetry.histogram("deals_cycle_duration_seconds", description="Time to scrape + push one cycle")
    seen = telemetry.counter("deals_seen_total", description="Deals scraped from the source")
    pushed = telemetry.counter("deals_pushed_total", description="Deals pushed to domain-api, by outcome")

    running = threading.Event()
    running.set()

    def _stop(_sig, _frame) -> None:
        running.clear()

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, _stop)

    log.info("%s up: poll every %ds, writes via domain-api", name, poll)

    while running.is_set():
        started = time.monotonic()
        outcome = "ok"
        try:
            with telemetry.tracer("deals-common").start_as_current_span(
                "scrape cycle", attributes={"worker": name}
            ):
                deals = load_deals()
                if deals:
                    result = push(deals)
                    if hasattr(result, "accepted"):
                        pushed.add(len(result.accepted), {"worker": name, "outcome": "accepted"})
                        pushed.add(len(result.rejected), {"worker": name, "outcome": "rejected"})
                        pushed.add(len(result.failed), {"worker": name, "outcome": "failed"})
                        log.info(
                            "cycle done in %.1fs: %d seen, %d accepted, %d rejected, %d failed",
                            time.monotonic() - started, len(deals),
                            len(result.accepted), len(result.rejected), len(result.failed),
                        )
                    else:
                        log.info("cycle done in %.1fs: %d seen, %d pushed", time.monotonic() - started, len(deals), len(result))
                seen.add(len(deals), {"worker": name})
        except Exception:
            outcome = "error"
            log.exception("cycle failed; retrying after the poll interval")
        if cycles:
            cycles.add(1, {"worker": name, "outcome": outcome})
        if duration:
            duration.record(time.monotonic() - started, {"worker": name})

        # Sleep in short slices so a SIGTERM lands in seconds.
        target = poll * (1 + random.uniform(-JITTER_FRACTION, JITTER_FRACTION))
        slept = 0.0
        while running.is_set() and slept < target:
            slept += 5.0 if running.wait(min(5.0, target - slept)) else target
    log.info("%s stopping", name)