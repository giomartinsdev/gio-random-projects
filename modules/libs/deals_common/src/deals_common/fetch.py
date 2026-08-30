"""HTTP layer for every scraper.

Sits on Scrapling's static Fetcher (curl_cffi TLS impersonation under
the hood) -- that alone got us 200s from the polled sources where
plain curl got 403'd by their asset CDN, so impersonation stays on by
default. No browser engines involved: the sources are plain JSON APIs,
which also sidesteped every arm64 concern about running stealth
browsers on the VPS.

Not source-specific: retries with backoff, a per-client rate limit and
timeout juggling live here so each worker is just endpoint + mapping.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urlencode

from scrapling.fetchers import Fetcher

log = logging.getLogger(__name__)


class HttpClient:
    def __init__(self, min_interval_s: float = 2.0, max_retries: int = 3, timeout_ms: int = 30_000):
        self._min_interval = min_interval_s
        self._max_retries = max_retries
        self._timeout_ms = timeout_ms
        self._last_request_at = 0.0

    def _throttle(self) -> None:
        # Simple gate, not a token bucket: a worker's schedule is one
        # source at a time, so "wait between calls" is all we need.
        wait = self._min_interval - (time.monotonic() - self._last_request_at)
        if wait > 0:
            time.sleep(wait)
        self._last_request_at = time.monotonic()

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        if params:
            url = f"{url}?{urlencode(params, doseq=True)}"

        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            self._throttle()
            try:
                res = Fetcher.get(url, impersonate="chrome", timeout=self._timeout_ms)
            except Exception as err:  # network hiccups shouldn't kill the cycle
                last_error = err
                log.warning("GET %s attempt %d failed: %s", url, attempt + 1, err)
                time.sleep(2**attempt)
                continue

            if res.status == 200:
                return res.json()

            last_error = RuntimeError(f"GET {url} -> HTTP {res.status}")
            log.warning(str(last_error))
            time.sleep(2**attempt)

        raise last_error or RuntimeError(f"GET {url} failed after retries")