"""The read path (Scrapling's Fetcher): the challenge dance -- a
CF-mitigated 403 gets exactly one FlareSolverr solve, the clearance is
reused across calls, and a plain 403 never wakes the solver at all."""

from __future__ import annotations

import io
import json
import urllib.request

import pytest

import deals_common.fetch as fetch_module
from deals_common.fetch import ChallengeSolver, HttpClient


class _Res:
    """scrapling-shaped response stub (status + headers + json body)."""

    def __init__(self, status=200, headers=None, payload=None):
        self.status = status
        self.headers = headers or {}
        self._payload = payload

    def json(self):
        return self._payload


def challenge_403():
    # The exact shape the source's edge serves when it walls an endpoint
    # behind the JS challenge ("Just a moment..." lives in the raw body,
    # but the header pair is all the fetch layer keys on).
    return _Res(403, {"cf-mitigated": "challenge", "content-type": "text/html"})


class FakeFetcher:
    """Stands in for the module-level scrapling Fetcher."""

    def __init__(self, script):
        self.script = list(script)
        self.calls: list[dict] = []

    def get(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self.script.pop(0)


class FakeSolver:
    def __init__(self, script=None):
        self.script = list(script or [])
        self.urls: list[str] = []

    def solve(self, url):
        self.urls.append(url)
        outcome = self.script.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome  # (user_agent, cf_clearance)


def client_for(monkeypatch, fetcher, solver=None, **overrides):
    monkeypatch.setattr(fetch_module, "Fetcher", fetcher)
    kwargs = dict(min_interval_s=0, max_retries=3, sleeper=lambda *_: None)
    kwargs.update(overrides)
    client = HttpClient(**kwargs)
    client._solver = solver  # the fake stands in for the FlareSolverr client
    return client


# ---- challenge flow ---------------------------------------------------


def test_200_passes_straight_through_without_the_solver(monkeypatch):
    fetcher = FakeFetcher([_Res(200, payload={"feed": []})])
    solver = FakeSolver()
    client = client_for(monkeypatch, fetcher, solver)

    assert client.get_json("http://src.test/feed") == {"feed": []}
    assert solver.urls == []


def test_cleared_challenge_retries_with_cookie_and_ua(monkeypatch):
    fetcher = FakeFetcher([challenge_403(), _Res(200, payload={"ok": True})])
    solver = FakeSolver([("ua-chrome/99", "ck-1")])
    client = client_for(monkeypatch, fetcher, solver)

    assert client.get_json("http://src.test/feed") == {"ok": True}
    assert solver.urls == ["http://src.test/feed"]

    first, second = fetcher.calls
    assert first["headers"] is None  # nothing special before the solve
    assert second["headers"]["cookie"] == "cf_clearance=ck-1"
    # The clearance is bound to the UA that passed the challenge.
    assert second["headers"]["user-agent"] == "ua-chrome/99"


def test_challenge_without_a_solver_fails_like_any_403(monkeypatch):
    fetcher = FakeFetcher([challenge_403()] * 4)
    client = client_for(monkeypatch, fetcher)  # no flaresolverr_url wired

    with pytest.raises(RuntimeError, match="HTTP 403"):
        client.get_json("http://src.test/feed")
    assert len(fetcher.calls) == 4


def test_a_failed_solve_is_not_retried_within_the_call(monkeypatch):
    fetcher = FakeFetcher([challenge_403()] * 4)
    solver = FakeSolver([RuntimeError("solver down")])
    client = client_for(monkeypatch, fetcher, solver)

    with pytest.raises(RuntimeError, match="HTTP 403"):
        client.get_json("http://src.test/feed")
    assert solver.urls == ["http://src.test/feed"]  # one solve budget
    assert len(fetcher.calls) == 4


def test_a_wasted_clearance_does_not_trigger_another_solve(monkeypatch):
    fetcher = FakeFetcher([challenge_403()] * 4)
    solver = FakeSolver([("ua-chrome/99", "ck-1")])
    client = client_for(monkeypatch, fetcher, solver)

    with pytest.raises(RuntimeError, match="HTTP 403"):
        client.get_json("http://src.test/feed")
    assert solver.urls == ["http://src.test/feed"]
    # The stale cookie is still what gets sent on the way out.
    assert fetcher.calls[-1]["headers"]["cookie"] == "cf_clearance=ck-1"


def test_clearance_survives_across_calls_without_re_solving(monkeypatch):
    fetcher = FakeFetcher([challenge_403(), _Res(200, payload={"n": 1}), _Res(200, payload={"n": 2})])
    solver = FakeSolver([("ua-chrome/99", "ck-1")])
    client = client_for(monkeypatch, fetcher, solver)

    assert client.get_json("http://src.test/feed") == {"n": 1}
    assert client.get_json("http://src.test/feed") == {"n": 2}
    assert solver.urls == ["http://src.test/feed"]
    assert fetcher.calls[2]["headers"]["cookie"] == "cf_clearance=ck-1"


def test_plain_403_never_wakes_the_solver(monkeypatch):
    fetcher = FakeFetcher([_Res(403, {"content-type": "text/html"})] * 4)
    solver = FakeSolver()
    client = client_for(monkeypatch, fetcher, solver)

    with pytest.raises(RuntimeError, match="HTTP 403"):
        client.get_json("http://src.test/feed")
    assert solver.urls == []


# ---- the FlareSolverr client -----------------------------------------


class _FakeUrlOpen:
    def __init__(self, body: bytes):
        self.body = body
        self.requests: list[tuple[urllib.request.Request, int | None]] = []

    def __call__(self, req, timeout=None):
        self.requests.append((req, timeout))
        return io.BytesIO(self.body)


def _fs_ok(ua="ua/1", clearance="cf-1") -> bytes:
    return json.dumps(
        {
            "status": "ok",
            "message": "",
            "solution": {
                "status": 200,
                "url": "http://src.test/feed",
                "userAgent": ua,
                "cookies": [{"name": "cf_clearance", "value": clearance}],
            },
        }
    ).encode("utf-8")


def test_solve_posts_request_get_and_returns_the_pair():
    opener = _FakeUrlOpen(_fs_ok(ua="ua/1", clearance="cf-1"))
    solver = ChallengeSolver("http://flaresolverr:8191/", urlopen=opener)

    assert solver.solve("http://src.test/feed") == ("ua/1", "cf-1")

    req, timeout = opener.requests[0]
    assert req.full_url == "http://flaresolverr:8191/v1"
    assert req.get_method() == "POST"
    assert req.headers["Content-type"] == "application/json"  # urllib capitalizes
    # returnOnlyCookies: the page body never crosses back -- we want
    # cookies and UA, nothing else.
    assert json.loads(req.data) == {
        "cmd": "request.get",
        "url": "http://src.test/feed",
        "maxTimeout": 60000,  # default timeout_s=75, minus the 15s margin
        "returnOnlyCookies": True,
    }
    assert timeout == 75


def test_solve_raises_when_the_solver_reports_failure():
    opener = _FakeUrlOpen(json.dumps({"status": "error", "message": "Error solving the challenge"}).encode("utf-8"))
    solver = ChallengeSolver("http://flaresolverr:8191", urlopen=opener)

    try:
        solver.solve("http://src.test/feed")
    except RuntimeError as err:
        assert "Error solving the challenge" in str(err)
    else:
        raise AssertionError("solve must fail when flaresolverr reports an error")


def test_solve_raises_when_the_page_still_is_not_200():
    opener = _FakeUrlOpen(json.dumps({"status": "ok", "solution": {"status": 503, "cookies": []}}).encode("utf-8"))
    solver = ChallengeSolver("http://flaresolverr:8191", urlopen=opener)

    with pytest.raises(RuntimeError, match="solve failed"):
        solver.solve("http://src.test/feed")


def test_solve_raises_without_a_clearance_cookie():
    body = json.dumps({"status": "ok", "solution": {"status": 200, "cookies": [], "userAgent": "ua/1"}}).encode(
        "utf-8"
    )
    opener = _FakeUrlOpen(body)
    solver = ChallengeSolver("http://flaresolverr:8191", urlopen=opener)

    with pytest.raises(RuntimeError, match="no cf_clearance"):
        solver.solve("http://src.test/feed")