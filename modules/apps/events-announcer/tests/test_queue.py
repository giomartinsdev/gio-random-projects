"""EventQueue against a tiny in-memory redis stand-in — the semantics
under test are list order and decode tolerance, not redis itself."""

from __future__ import annotations

import json

import pytest

from events_announcer.queue import EventQueue


class FakeRedis:
    """Just the four list ops the queue uses, with real redis
    orientation: the list is head..tail as a python list, LPUSH inserts
    each value at the head (later pushes come out first), LPOP/BLPOP
    take from the head."""

    def __init__(self) -> None:
        self.data: dict[str, list] = {}

    def lpop(self, key):
        if not self.data.get(key):
            return None
        raw = self.data[key].pop(0)
        # the app connects with decode_responses=True: redis returns str
        return raw.decode() if isinstance(raw, bytes) else raw

    def lpush(self, key, *values):
        data = self.data.setdefault(key, [])
        for value in values:
            data.insert(0, value)
        return len(data)

    def llen(self, key):
        return len(self.data.get(key, []))

    def blpop(self, key, timeout=0):
        # Tests pre-fill before calling; "blocking" just means pop-one-or-None
        raw = self.lpop(key)
        return (key, raw) if raw is not None else None


@pytest.fixture
def queue():
    return EventQueue(FakeRedis())


def _event(source: str = "pld", deal_id: str = "d1") -> str:
    return json.dumps(
        {
            "event_name": "deal.created",
            "occurred_at": "2026-08-30T10:00:00Z",
            "payload": {"source": source, "source_deal_id": deal_id, "title": "t", "url": "https://x/y"},
        }
    )


def test_pop_drains_oldest_first(queue):
    queue.client.lpush(queue.key, _event(deal_id="d2"), _event(deal_id="d1"), _event(deal_id="d3"))

    popped = queue.pop(2)

    ids = [e["payload"]["source_deal_id"] for e in popped]
    assert ids == ["d3", "d1"]  # d3 is the head (last LPUSHed), d1 behind it


def test_pop_stops_at_empty(queue):
    queue.client.lpush(queue.key, _event())
    assert len(queue.pop(10)) == 1
    assert queue.pop(10) == []


def test_listen_blpop_then_drains_burst(queue):
    queue.client.lpush(queue.key, _event("pld", "a"), _event("phb", "b"), _event("pld", "c"))

    events = queue.listen(timeout_s=1)

    assert [e["payload"]["source_deal_id"] for e in events] == ["c", "b", "a"]


def test_listen_empty_returns_empty_list(queue):
    # Happy path: server answered nil inside the block window.
    assert queue.listen(timeout_s=1) == []


def test_listen_swallows_client_side_block_timeout(queue):
    # redis-py (8.x) sometimes surfaces the BLPOP block expiry as a
    # client TimeoutError instead of a nil reply — that is still just
    # "nothing there" and must idle the loop, not crash it.
    class TimeoutyRedis(FakeRedis):
        def blpop(self, key, timeout=0):
            import redis as redis_module

            raise redis_module.exceptions.TimeoutError("block expired")

    queue = EventQueue(TimeoutyRedis())
    assert queue.listen(timeout_s=1) == []


def test_requeue_front_keeps_order_at_the_head(queue):
    queue.client.lpush(queue.key, _event("pld", "newer"))
    keep = [{"payload": {"source_deal_id": "e2"}, "_announce_attempts": 1}, {"payload": {"source_deal_id": "e1"}}]

    queue.requeue_front(keep)

    events = queue.pop(10)
    ids = [e["payload"]["source_deal_id"] for e in events]
    # e1 (first requeued argument) is deepest of the pair, so e2 pops
    # first — and both land ahead of the untouched "newer" event.
    assert ids == ["e2", "e1", "newer"]
    assert events[0]["_announce_attempts"] == 1  # attempt metadata survives the round trip


def test_malformed_payload_becomes_marker_event(queue):
    queue.client.lpush(queue.key, b"not json{", _event("phb", "ok"))

    events = queue.pop(10)

    ok = events[0]
    assert ok["payload"]["source_deal_id"] == "ok"
    broken = events[1]
    assert broken.get("malformed") == "not json{"
    assert broken["event_name"] == ""


def test_depth(queue):
    assert queue.depth() == 0
    queue.client.lpush(queue.key, _event(), _event())
    assert queue.depth() == 2