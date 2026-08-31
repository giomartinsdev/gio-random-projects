"""HTTP layer for every scraper.

Sits on Scrapling's static Fetcher (curl_cffi TLS impersonation under
the hood) -- that alone got us 200s from the polled sources where
plain curl got 403'd by their asset CDN, so impersonation stays on by
default. No browser engines involved -- except for the one case the
sources forced: when an edge answers with Cloudflare's JS challenge
(``cf-mitigated: challenge``), no amount of fingerprinting passes and
the URL gets handed to a FlareSolverr sidecar (module
compute/services/flaresolverr), whose challenge-capable browser wins a
cf_clearance the plain client then reuses. Activation is strictly
challenge-gated and off unless FLARESOLVERR_URL is set, so the
no-browser posture survives for every source that doesn't wall itself.

Not source-specific: retries with backoff, a per-client rate limit and
timeout juggling live here so each worker is just endpoint + mapping.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
from collections.abc import Callable
from typing import Any
from urllib.parse import urlencode

from scrapling.fetchers import Fetcher

log = logging.getLogger(__name__)


class ChallengeSolver:
    """Client for a FlareSolverr instance (challenge-solver sidecar).

    ``solve`` asks it to load a URL in its embedded, challenge-capable
    browser and returns ``(user_agent, cf_clearance)`` -- with
    returnOnlyCookies so the response never ships a page body back. A
    solve that doesn't end in a clearance cookie raises; the fetch loop
    decides what that means (skip the cycle, not a crash).
    """

    def __init__(self, base_url: str, urlopen: Callable | None = None, timeout_s: float = 75.0):
        self._base = base_url.rstrip("/")
        self._open = urlopen or urllib.request.urlopen
        self._timeout_s = timeout_s

    def solve(self, url: str) -> tuple[str, str]:
        payload = {
            "cmd": "request.get",
            "url": url,
            # The urllib timeout is the outer budget; leave the inner
            # solve room to fail fast inside it.
            "maxTimeout": int((self._timeout_s - 15) * 1000),
            "returnOnlyCookies": True,
        }
        req = urllib.request.Request(
            f"{self._base}/v1",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json"},
        )
        with self._open(req, timeout=self._timeout_s) as answer:
            body = json.load(answer)

        solution = body.get("solution") or {}
        if body.get("status") != "ok" or solution.get("status") != 200:
            raise RuntimeError(f"flaresolverr solve failed: {body.get('message') or 'status not ok'}")
        clearance = next(
            (c.get("value") for c in solution.get("cookies") or [] if c.get("name") == "cf_clearance"),
            None,
        )
        if not clearance:
            raise RuntimeError("flaresolverr returned no cf_clearance cookie")
        return solution.get("userAgent") or "", clearance


def _header_value(res: object, name: str) -> str:
    headers = getattr(res, "headers", None) or {}
    get = getattr(headers, "get", None)
    value = get(name) if callable(get) else None
    if value is None:
        for key, val in dict(headers).items():
            if str(key).lower() == name:
                value = val
                break
    return value or ""


class HttpClient:
    def __init__(
        self,
        min_interval_s: float = 2.0,
        max_retries: int = 3,
        timeout_ms: int = 30_000,
        flaresolverr_url: str = "",
        sleeper: Callable | None = None,
    ):
        self._min_interval = min_interval_s
        self._max_retries = max_retries
        self._timeout_ms = timeout_ms
        self._last_request_at = 0.0
        self._sleep = sleeper or time.sleep
        # Challenge workaround: off entirely unless an endpoint is given.
        self._solver = ChallengeSolver(flaresolverr_url) if flaresolverr_url else None
        self._clearance: tuple[str, str] | None = None  # (user-agent, cf_clearance)

    def _throttle(self) -> None:
        # Simple gate, not a token bucket: a worker's schedule is one
        # source at a time, so "wait between calls" is all we need.
        wait = self._min_interval - (time.monotonic() - self._last_request_at)
        if wait > 0:
            self._sleep(wait)
        self._last_request_at = time.monotonic()

    def _extra_headers(self) -> dict | None:
        if self._clearance is None:
            return None
        user_agent, clearance = self._clearance
        extra: dict[str, str] = {"cookie": f"cf_clearance={clearance}"}
        # The clearance is bound to the UA that passed the challenge.
        if user_agent:
            extra["user-agent"] = user_agent
        return extra

    def _challenged(self, res: object) -> bool:
        try:
            status = res.status  # type: ignore[attr-defined]
        except AttributeError:
            return False
        return status == 403 and _header_value(res, "cf-mitigated").lower() == "challenge"

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        if params:
            url = f"{url}?{urlencode(params, doseq=True)}"

        last_error: Exception | None = None
        solved_here = False
        for attempt in range(self._max_retries + 1):
            self._throttle()
            try:
                res = Fetcher.get(
                    url,
                    impersonate="chrome",
                    timeout=self._timeout_ms,
                    headers=self._extra_headers(),
                )
            except Exception as err:  # network hiccups shouldn't kill the cycle
                last_error = err
                log.warning("GET %s attempt %d failed: %s", url, attempt + 1, err)
                self._sleep(2**attempt)
                continue

            if res.status == 200:
                return res.json()

            if self._challenged(res):
                # Only a real browser passes this -- one solve per call is
                # the budget; afterwards the plain retries just fail out.
                if self._solver is not None and not solved_here:
                    solved_here = True
                    try:
                        self._clearance = self._solver.solve(url)
                        log.info("challenge hit; cf_clearance won via flaresolverr")
                    except Exception as err:
                        log.warning("challenge hit and flaresolverr solve failed: %s", err)
                else:
                    log.warning("GET %s -> HTTP 403 (challenge) after the clearance attempt", url)
            else:
                log.warning("GET %s -> HTTP %s", url, res.status)
            last_error = RuntimeError(f"GET {url} -> HTTP {res.status}")
            self._sleep(2**attempt)

        raise last_error or RuntimeError(f"GET {url} failed after retries")