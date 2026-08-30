"""The announce loop's rules: what gets posted, what gets dropped,
what comes back to the head of the queue — against a fake redis and a
fake webhook, no sleeping."""

from __future__ import annotations

import threading
from datetime import UTC, datetime, timedelta

import pytest

from events_announcer.announcer import Announcer, RateLimited
from events_announcer.queue import EventQueue


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, list] = {}

    def lpop(self, key):
        if not self.data.get(key):
            return None
        return self.data[key].pop(0)

    def lpush(self, key, *values):
        data = self.data.setdefault(key, [])
        for value in values:
            data.insert(0, value)
        return len(data)

    def llen(self, key):
        return len(self.data.get(key, []))

    def blpop(self, key, timeout=0):
        raw = self.lpop(key)
        return (key, raw) if raw is not None else None


class Recorder:
    """Stands in for the Discord POST."""

    def __init__(self, failures=None):
        self.calls: list[dict] = []
        self.failures = failures or []  # exceptions per call index, None = ok

    def __call__(self, url, body):
        outcome = self.failures[len(self.calls)] if len(self.calls) < len(self.failures) else None
        self.calls.append({"url": url, **body})
        if outcome is not None:
            raise outcome() if isinstance(outcome, type) else outcome


@pytest.fixture
def queue():
    return EventQueue(FakeRedis())


@pytest.fixture
def recorder():
    return Recorder()


@pytest.fixture
def announcer(queue, recorder):
    return Announcer(queue, "https://hook", post=recorder, sleeper=lambda _s: None)


def _ago(**kwargs) -> str:
    return (datetime.now(tz=UTC) - timedelta(**kwargs)).isoformat()


def _envelope(deal_id: str, *, posted: str | None = None, event_name="deal.created", **payload_extra):
    payload = {
        "source": "pld",
        "source_deal_id": deal_id,
        "title": f"Deal {deal_id}",
        "url": f"https://x/{deal_id}",
        "price_cents": 1000,
        "old_price_cents": 2000,
        "store": "Loja",
        "posted_at": posted if posted is not None else _ago(hours=1),
        "scraped_at": _ago(minutes=5),
    }
    payload.update(payload_extra)
    return {"event_name": event_name, "occurred_at": payload["scraped_at"], "payload": payload}


def _feed(queue, *events):
    queue.requeue_front(list(events))


# ---- eligibility ----------------------------------------------------


def test_fresh_deal_posts_one_message_per_deal(announcer, recorder, queue):
    event = _envelope("d1")
    _feed(queue, event)

    announcer.handle(queue.listen(timeout_s=1))

    assert len(recorder.calls) == 1
    assert recorder.calls[0]["url"] == "https://hook"
    assert "Deal d1" in recorder.calls[0]["content"]
    assert "https://x/d1" in recorder.calls[0]["content"]
    assert queue.depth() == 0  # fully consumed


def test_posts_oldest_first_by_posted_at(announcer, recorder, queue):
    _feed(
        queue,
        _envelope("recent", posted=_ago(hours=1)),
        _envelope("oldest", posted=_ago(hours=42)),
        _envelope("middle", posted=_ago(hours=20)),
    )

    announcer.handle(queue.listen(timeout_s=1))

    titles = [c["content"].splitlines()[0] for c in recorder.calls]
    assert titles == ["🔥 **Deal oldest**", "🔥 **Deal middle**", "🔥 **Deal recent**"]


def test_only_matching_events_are_announced(announcer, recorder, queue):
    _feed(
        queue,
        _envelope("nope", event_name="deal.updated"),
        _envelope("broken"),  # malformed marker shape is tested in test_queue
        _envelope("good"),
    )
    events = queue.listen(timeout_s=1)
    events[1]["malformed"] = True  # simulate the decode marker

    announcer.handle(events)

    assert [c["content"] for c in recorder.calls] == [
        "🔥 **Deal good**\nR$ 10,00 ~~R$ 20,00~~ (-50%)\n🏪 Loja · pld\nhttps://x/good"
    ]
    assert queue.depth() == 0


def test_unusable_payload_is_dropped_not_posted(announcer, recorder, queue):
    _feed(queue, {"event_name": "deal.created", "occurred_at": _ago(hours=1), "payload": {"title": "no url"}})

    announcer.handle(queue.pop(1))

    assert recorder.calls == []
    assert queue.depth() == 0


def test_stale_deal_is_dropped(announcer, recorder, queue):
    _feed(queue, _envelope("old", posted=_ago(days=3)), _envelope("fresh", posted=_ago(hours=2)))

    announcer.handle(queue.listen(timeout_s=1))

    assert len(recorder.calls) == 1
    assert "Deal fresh" in recorder.calls[0]["content"]
    assert queue.depth() == 0  # stale is dropped, not requeued


# ---- caps and backpressure ------------------------------------------


def test_cap_overflow_requeues_rest_oldest_first(announcer, recorder, queue):
    announcer.max_per_flush = 2
    _feed(
        queue,
        _envelope("e1", posted=_ago(hours=5)),
        _envelope("e2", posted=_ago(hours=4)),
        _envelope("e3", posted=_ago(hours=3)),
        _envelope("e4", posted=_ago(hours=2)),
    )

    announcer.handle(queue.listen(timeout_s=1))

    assert "Deal e1" in recorder.calls[0]["content"]
    assert "Deal e2" in recorder.calls[1]["content"]
    assert [e["payload"]["source_deal_id"] for e in queue.pop(10)] == ["e3", "e4"]


def test_rate_limit_requeues_failing_and_unattempted(announcer, recorder, queue):
    recorder.failures = [RateLimited(30.0)]
    _feed(
        queue,
        _envelope("e1", posted=_ago(hours=3)),
        _envelope("e2", posted=_ago(hours=2)),
        _envelope("e3", posted=_ago(hours=1)),
    )

    with pytest.raises(RateLimited):
        announcer.handle(queue.listen(timeout_s=1))

    remaining = queue.pop(10)
    ids = [e["payload"]["source_deal_id"] for e in remaining]
    assert ids == ["e1", "e2", "e3"]  # nothing lost to the 429
    assert remaining[0]["_announce_attempts"] == 1  # failing event counts the attempt
    assert "_announce_attempts" not in remaining[1]  # e2/e3 were never tried


def test_rate_limit_past_max_attempts_drops_the_failing_event(announcer, recorder, queue):
    announcer.max_requeues = 2
    recorder.failures = [RateLimited(5.0)] * 3
    _feed(queue, _envelope("doomed"))

    for _ in range(3):
        with pytest.raises(RateLimited):
            announcer.handle(queue.pop(1))

    assert queue.depth() == 0  # attempts exhausted -> dropped


def test_post_failure_requeues_with_bump_until_max(announcer, recorder, queue):
    announcer.max_requeues = 2
    recorder.failures = [RuntimeError] * 3
    _feed(queue, _envelope("flaky"))

    announcer.handle(queue.pop(1))  # attempt 1 -> requeued
    assert queue.depth() == 1
    e1 = queue.pop(1)[0]
    assert e1["_announce_attempts"] == 1

    announcer.handle([e1])  # attempt 2 -> requeued
    assert queue.depth() == 1
    e2 = queue.pop(1)[0]
    assert e2["_announce_attempts"] == 2

    announcer.handle([e2])  # attempt cap reached -> dropped
    assert queue.depth() == 0
    assert len(recorder.calls) == 3


def test_rate_limit_waits_retry_after(queue):
    slept: list[float] = []
    running = threading.Event()
    running.set()
    ann = Announcer(queue, "https://hook", post=Recorder(), sleeper=slept.append)
    _feed(queue, _envelope("only"))

    def throttled_then_stop(url, body):
        running.clear()
        raise RateLimited(1.5)

    ann._post = throttled_then_stop

    ann.run_forever(running)

    assert 1.5 in slept  # the throttled pass waited what Discord asked


def test_announcing_off_still_drains(queue):
    recorder = Recorder()
    ann = Announcer(queue, "", post=recorder, sleeper=lambda _s: None)
    _feed(queue, _envelope("a"), _envelope("nope", event_name="deal.updated"))

    ann.handle(queue.listen(timeout_s=1))

    assert recorder.calls == []  # nothing posted
    assert queue.depth() == 0  # but the queue drained anyway


def test_run_forever_survives_a_pass_crashing(queue):
    recorder = Recorder()
    ann = Announcer(queue, "https://hook", post=recorder, sleeper=lambda _s: None)
    running = threading.Event()
    running.set()
    _feed(queue, _envelope("boom"))

    class Boom(Exception):
        pass

    def explode(events):  # a bug inside handle(), not in the webhook
        running.clear()
        raise Boom

    ann.handle = explode
    ann.run_forever(running)  # must not raise
    assert queue.depth() == 0  # batch was already popped; crash drops it, loop exits cleanly