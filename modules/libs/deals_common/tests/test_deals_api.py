"""The domain-api write path: request/answer accounting, retry and
pace rules, and the wire shape domain-api's UpsertInput expects."""

from __future__ import annotations

import io
import json
import urllib.error
from datetime import UTC, datetime

import pytest

from deals_common.deals_api import DealsClient, PushResult
from deals_common.model import RawDeal


def _deal(**overrides):
    base = dict(
        source="pld",
        source_deal_id="d1",
        title="Teclado 65%",
        url="https://exemplo.dev/teclado",
        store="Loja",
        price_cents=34999,
        old_price_cents=99999,
        posted_at=datetime(2026, 8, 30, 21, 0, tzinfo=UTC),
        scraped_at=datetime(2026, 8, 30, 21, 30, tzinfo=UTC),
        payload={"promo": "cupom"},
    )
    base.update(overrides)
    return RawDeal(**base)


class _Response:
    def __init__(self, status=202):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeAPI:
    """Per-call scripts: ints are status codes, other entries are
    raised; empty script = every call succeeds with 202."""

    def __init__(self, script=None):
        self.script = list(script or [])
        self.requests: list[dict] = []

    def __call__(self, req, timeout=None):
        self.requests.append(
            {
                "url": req.full_url,
                "headers": {k.lower(): v for k, v in req.header_items()},
                "body": json.loads(req.data.decode("utf-8")),
                "method": req.get_method(),
            }
        )
        outcome = self.script.pop(0) if self.script else 202
        if isinstance(outcome, Exception):
            raise outcome
        if isinstance(outcome, int) and outcome >= 400:
            raise FakeAPI.http_error(outcome)  # urllib raises HTTPError for >=400
        return _Response(outcome)

    @staticmethod
    def http_error(code: int, retry_after: str | None = None) -> urllib.error.HTTPError:
        hdrs = {"retry-after": retry_after} if retry_after is not None else {}
        return urllib.error.HTTPError(
            "http://x",
            code,
            "oops",
            hdrs=hdrs,
            fp=io.BytesIO(b"{}"),
        )


class BrokenAPI(FakeAPI):
    """The network itself is down."""

    def __call__(self, req, timeout=None):
        raise OSError("connection reset")


@pytest.fixture
def rig():
    """(client, api, slept) — pacing sleeps land in `slept`, not the wall clock."""
    api = FakeAPI()
    slept: list[float] = []
    client = DealsClient("http://api.test", "k-test", min_interval_s=0, sleeper=slept.append)
    client._open = api
    return client, api, slept


# ---- wire shape ------------------------------------------------------


def test_accepted_202_with_exact_upsert_body(rig):
    client, api, _ = rig
    result = client.push_deals([_deal()])

    assert result.ok == 1 and not result.rejected and not result.failed
    req = api.requests[0]
    assert req["url"] == "http://api.test/deals"
    assert req["method"] == "POST"
    assert req["headers"]["x-api-key"] == "k-test"
    assert req["headers"]["content-type"] == "application/json"
    assert req["body"] == {
        "source": "pld",
        "source_deal_id": "d1",
        "title": "Teclado 65%",
        "url": "https://exemplo.dev/teclado",
        "scraped_at": "2026-08-30T21:30:00.000Z",
        "store": "Loja",
        "price_cents": 34999,
        "old_price_cents": 99999,
        "posted_at": "2026-08-30T21:00:00.000Z",
        "payload": {"promo": "cupom"},
    }


def test_optional_fields_stay_absent_when_none(rig):
    client, api, _ = rig
    client.push_deals(
        [_deal(store=None, price_cents=None, old_price_cents=None, posted_at=None, payload={})]
    )

    body = api.requests[0]["body"]
    for absent in ("store", "price_cents", "old_price_cents", "posted_at", "payload"):
        assert absent not in body


def test_naive_datetimes_are_read_as_utc(rig):
    """RawDeal's docstring contract: posted_at/scraped_at are UTC. The
    writer must not re-interpret a naive value through local tz."""
    client, api, _ = rig
    client.push_deals([_deal(posted_at=datetime(2026, 8, 30, 21, 0), scraped_at=datetime(2026, 8, 30, 20, 0))])
    assert api.requests[0]["body"]["posted_at"] == "2026-08-30T21:00:00.000Z"
    assert api.requests[0]["body"]["scraped_at"] == "2026-08-30T20:00:00.000Z"


def test_each_deal_is_its_own_post(rig):
    client, api, _ = rig
    result = client.push_deals([_deal(source_deal_id="a"), _deal(source_deal_id="b")])

    assert len(api.requests) == 2
    assert [r["body"]["source_deal_id"] for r in api.requests] == ["a", "b"]
    assert result.ok == 2


# ---- outcome accounting ----------------------------------------------


def test_client_error_rejects_without_retries(rig):
    client, api, _ = rig
    client._open = FakeAPI(script=[422])

    result = client.push_deals([_deal()])

    assert [d.source_deal_id for d in result.rejected] == ["d1"]
    assert len(client._open.requests) == 1  # no retrying a 4xx


def test_server_error_is_retried_then_accepted(rig):
    client, api, _ = rig
    client._open = FakeAPI(script=[FakeAPI.http_error(503), FakeAPI.http_error(503)])

    result = client.push_deals([_deal()])

    assert result.ok == 1
    assert len(client._open.requests) == 3  # 1 + max_retries(2) attempts


def test_network_noise_is_retried_then_failed(rig):
    client, api, _ = rig
    client._open = BrokenAPI()

    result = client.push_deals([_deal()])
    assert [d.source_deal_id for d in result.failed] == ["d1"]


def test_429_honours_retry_after_header(rig):
    client, api, _ = rig
    client._open = FakeAPI(
        script=[FakeAPI.http_error(429, retry_after="1"), 202]
    )

    result = client.push_deals([_deal()])
    assert result.ok == 1


def test_failure_of_one_deal_does_not_skip_the_rest(rig):
    client, api, _ = rig
    client.max_retries = 2
    # deal a burns its retries (500 x3 with max_retries=2), b and c sail
    # through — one poisoned deal must not take the cycle down.
    client._open = FakeAPI(script=[FakeAPI.http_error(500)] * 3 + [202, 202])

    result = client.push_deals(
        [_deal(source_deal_id="a"), _deal(source_deal_id="b"), _deal(source_deal_id="c")]
    )

    assert [d.source_deal_id for d in result.failed] == ["a"]
    assert [d.source_deal_id for d in result.accepted] == ["b", "c"]
    assert len(client._open.requests) == 5


# ---- env + meta ------------------------------------------------------


def test_from_env_requires_both_values():
    with pytest.raises(ValueError, match="DOMAIN_API"):
        DealsClient.from_env(env={})
    client = DealsClient.from_env(env={"DOMAIN_API_URL": "http://api.test/", "DOMAIN_API_KEY": "kk"})
    assert client.base_url == "http://api.test"  # trailing slash stripped


def test_push_paces_between_posts(rig):
    client, api, slept = rig
    client.min_interval_s = 25.0  # would stall real time without the fake sleeper
    client.push_deals([_deal(), _deal()])

    # first post has no predecessor (waits <= 0 → no sleep); the second
    # one owes the full interval
    assert len(slept) == 1
    assert abs(slept[0] - 25.0) < 0.5


def test_pushresult_defaults():
    empty = PushResult()
    assert empty.ok == 0
    assert (empty.accepted, empty.rejected, empty.failed) == ([], [], [])