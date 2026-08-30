"""The announce loop: drain the event queue, post fresh deals to
Discord, keep going until SIGTERM.

Announce-only on purpose: a posting that fails more than
max_requeues times is dropped with a counter, not retried forever —
the deal is already stored in raw_deals by the time its event got
here, and re-announcing a two-day-old discount is worse than not
announcing it.

Everything a flush pops is accounted for, in one of four buckets:
posted, requeued (cap overflow or a failed post, attempts tracked in
the envelope), stale-dropped, or skipped (not an event we announce /
unusable payload). Nothing pops off this queue and just vanishes
silently.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from deals_common import telemetry
from .queue import EventQueue
from deals_common.announce import MAX_PER_FLUSH, deal_from_event, render

log = logging.getLogger(__name__)

_ATTEMPTS_KEY = "_announce_attempts"  # rides inside the envelope, one bump per requeue


class RateLimited(Exception):
    """Discord said 429 — carry the seconds it asked us to wait."""

    def __init__(self, retry_after_s: float) -> None:
        super().__init__(f"rate limited, retry after {retry_after_s}s")
        self.retry_after_s = retry_after_s


class Announcer:
    def __init__(
        self,
        queue: EventQueue,
        webhook_url: str | None,
        *,
        event_names: tuple[str, ...] = ("deal.created",),
        max_per_flush: int = MAX_PER_FLUSH,
        max_age_s: float = 48 * 3600,
        min_interval_s: float = 2.0,
        max_requeues: int = 3,
        post: Callable[[str, dict[str, Any]], None] | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.queue = queue
        self.webhook_url = (webhook_url or "").strip()
        self.event_names = event_names
        self.max_per_flush = max_per_flush
        self.max_age_s = max_age_s
        self.min_interval_s = min_interval_s
        self.max_requeues = max_requeues
        self._post = post or self._http_post
        self._sleep = sleeper

        self.announcements = telemetry.counter("announcer_announcements_total", description="Deals announced, by source")
        self.flushes = telemetry.counter("announcer_flushes_total", description="Queue flush passes, by outcome")
        self.stale = telemetry.counter("announcer_events_stale_total", description="Events dropped as too old")
        self.queue_depth_gauge = telemetry.gauge("announcer_queue_depth", description="Events waiting on domain.events.queue")

    # ---- loop ---------------------------------------------------------

    def run_forever(self, running: threading.Event, idle_timeout_s: int = 5) -> None:
        log.info(
            "announcer up: events=%s, max_per_flush=%d, max_age=%.0fs, announcing=%s",
            ",".join(self.event_names), self.max_per_flush, self.max_age_s,
            "on" if self.webhook_url else "off",
        )
        while running.is_set():
            events = self.queue.listen(idle_timeout_s)
            if not events:
                self._record_depth("idle")
                continue
            outcome = "done"
            try:
                self.handle(events)
            except RateLimited as exc:  # its batch was already requeued
                log.info("rate limited; waiting %.1fs before the next pass", exc.retry_after_s)
                self._sleep(exc.retry_after_s)
                outcome = "rate_limited"
            except Exception:
                # Announce-only: an unexpected bug in this single pass
                # drops that one batch rather than retry-looping it
                # forever — transient webhook failures are handled (and
                # requeued) inside handle() itself.
                log.exception("flush pass crashed; its remaining events are dropped")
                outcome = "crashed"
            self._record_depth(outcome)

    def handle(self, events: list[dict[str, Any]]) -> None:
        """One flush pass over already-popped events."""
        if self.flushes:
            self.flushes.add(1)

        wanted = [e for e in events if e.get("event_name") in self.event_names and not e.get("malformed")]
        skipped = len(events) - len(wanted)

        # Parse + age-filter; the age anchor is the deal's own publish
        # date (posted_at), falling back to scraped_at — an old deal
        # surfacing late must not announce as news.
        pairs: list[tuple[Any, dict[str, Any]]] = []
        stale = 0
        for event in wanted:
            parsed = deal_from_event(event)
            if parsed is None:
                log.warning("unusable %s event dropped: %s", event.get("event_name"), _brief(event))
                skipped += 1
                continue
            deal, occurred_at = parsed
            anchor = deal.posted_at or deal.scraped_at or occurred_at
            if (datetime.now(tz=UTC) - anchor).total_seconds() > self.max_age_s:
                stale += 1
                continue
            pairs.append((deal, event))
        if stale and self.stale:
            self.stale.add(stale)
        if stale:
            log.info("dropped %d stale event(s) (older than %.0fs)", stale, self.max_age_s)

        # Oldest first; whatever doesn't fit in this flush's cap goes
        # back to the queue head so it comes back next pass.
        pairs.sort(key=lambda pair: pair[0].posted_at or pair[0].scraped_at)
        to_post, overflow = pairs[: self.max_per_flush], pairs[self.max_per_flush:]

        # Failed postings collect here (attempts already bumped) and go
        # back at the head with the overflow at the end of this pass.
        # Order matters: requeue_front's list IS the desired pop order,
        # oldest-first.
        failed: list[dict[str, Any]] = []
        outcome = "posted" if self.webhook_url else "dry"
        last_post = float("-inf")
        for index, (deal, event) in enumerate(to_post):
            wait = self.min_interval_s - (time.monotonic() - last_post)
            if wait > 0:
                self._sleep(wait)
            if not self.webhook_url:
                # Announcing off — keep draining (see README): count the
                # would-have-posted deals so the gap stays visible.
                if self.announcements:
                    self.announcements.add(1, {"source": deal.source, "outcome": outcome})
                log.info("would announce %s (%s)", _brief(event), outcome)
                continue
            try:
                self._post(self.webhook_url, {"content": render(deal)})
                if self.announcements:
                    self.announcements.add(1, {"source": deal.source, "outcome": outcome})
                last_post = time.monotonic()
            except RateLimited:
                # Back off: the failing deal (attempt counted) plus every
                # never-attempted sibling behind it and the overflow —
                # none of them may vanish just because we're stopping.
                retried = failed + ([_bump(event)] if _attempts(event) < self.max_requeues else [])
                self.queue.requeue_front(
                    retried + [e for _d, e in to_post[index + 1 :]] + [e for _d, e in overflow]
                )
                raise
            except Exception as err:
                log.warning("post failed for %s: %s", deal.source_deal_id, err)
                if _attempts(event) < self.max_requeues:
                    failed.append(_bump(event))
                else:
                    log.error("giving up on %s after %d attempts", deal.source_deal_id, self.max_requeues)

        requeue = failed + [event for _deal, event in overflow]
        if requeue:
            self.queue.requeue_front(requeue)
        if skipped:
            log.info("skipped %d matching-but-unusable/non-matching event(s)", skipped)
        if to_post:
            log.info("flush done: %d posted, %d requeued, %d dropped", len(to_post), len(requeue), stale)

    # ---- plumbing -----------------------------------------------------

    def _http_post(self, webhook_url: str, body: dict[str, Any]) -> None:
        import urllib.error
        import urllib.request

        req = urllib.request.Request(
            webhook_url,
            data=json.dumps(body).encode("utf-8"),
            headers={"content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                if not 200 <= res.status < 300:
                    raise RuntimeError(f"unexpected status {res.status}")
        except urllib.error.HTTPError as err:
            if err.code == 429:
                raise RateLimited(_retry_after_s(err)) from err
            raise

    def _record_depth(self, outcome: str) -> None:
        depth = self.queue.depth()
        log.info("queue depth %d (%s)", depth, outcome)
        if self.queue_depth_gauge:
            try:
                self.queue_depth_gauge.set(depth)
            except Exception:
                pass


def _attempts(event: dict[str, Any]) -> int:
    return int(event.get(_ATTEMPTS_KEY, 0))


def _bump(event: dict[str, Any]) -> dict[str, Any]:
    event = dict(event)
    event[_ATTEMPTS_KEY] = _attempts(event) + 1
    return event


def _retry_after_s(err: Any) -> float:
    """Discord sends retry_after in MILLISECONDS (JSON body); the
    header fallback is seconds. Read the body first."""
    try:
        data = json.loads(err.read() or b"{}")
        if "retry_after" in data:
            return float(data["retry_after"]) / 1000.0
    except Exception:
        pass
    try:
        return float(err.headers.get("retry-after", "1"))
    except Exception:
        return 1.0


def _brief(event: dict[str, Any]) -> str:
    payload = event.get("payload") or {}
    return f"{event.get('event_name')}:{payload.get('source')}:{payload.get('source_deal_id')}"