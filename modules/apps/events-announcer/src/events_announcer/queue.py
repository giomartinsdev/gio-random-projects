"""The consumer side of domain.events.queue.

Redis list semantics: the worker RPUSHes (appends right); this side
LPOPs from the left (oldest first) and requeues failures with LPUSH so
a retried event goes back to the head — still oldest-first, still
before everything newer.
"""

from __future__ import annotations

import json
from typing import Any

import redis


class EventQueue:
    def __init__(self, client: "redis.Redis", key: str = "domain.events.queue") -> None:
        self.client = client
        self.key = key

    def __repr__(self) -> str:  # helps debug which key an instance binds
        return f"EventQueue(key={self.key!r})"

    def pop(self, n: int) -> list[dict[str, Any]]:
        """Drain up to n envelopes non-blockingly (oldest first)."""
        events: list[dict[str, Any]] = []
        for _ in range(max(0, n)):
            raw = self.client.lpop(self.key)
            if raw is None:
                break  # drained -- never spin on an empty list
            events.append(_decode(raw))
        return events

    def listen(self, timeout_s: int = 5) -> list[dict[str, Any]]:
        """Block for one envelope, then drain whatever's behind it.

        BLPOP keeps the loop asleep when there's nothing to do (no
        polling spin); the trailing pops turn a burst off the wire into
        one batch instead of one loop iteration per event.
        """
        try:
            item = self.client.blpop(self.key, timeout=timeout_s)
        except redis.exceptions.TimeoutError:
            # An expired block is "nothing there", not an error — on
            # some redis-py versions the client-side read timeout
            # surfaces instead of a nil reply, and must not kill the
            # worker (an idle queue is the normal steady state).
            item = None
        if item is None:
            return []
        events = [_decode(item[1])]
        while len(events) < 100:  # hard cap: a huge backlog drains over loops, not all at once
            raw = self.client.lpop(self.key)
            if raw is None:
                break
            events.append(_decode(raw))
        return events

    def requeue_front(self, events: list[dict[str, Any]]) -> None:
        """Put events back at the HEAD of the list, same order."""
        if not events:
            return
        self.client.lpush(self.key, *[json.dumps(e) for e in reversed(events)])

    def depth(self) -> int:
        return int(self.client.llen(self.key))


def _decode(raw: Any) -> dict[str, Any]:
    try:
        event = json.loads(raw)
        if isinstance(event, dict):
            return event
    except (TypeError, ValueError, UnicodeDecodeError):
        pass
    return {"event_name": "", "occurred_at": None, "payload": None, "malformed": raw}