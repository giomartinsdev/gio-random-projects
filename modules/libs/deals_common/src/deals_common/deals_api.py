"""The scrapers' write path: POST /deals on domain-api instead of a
Postgres connection (the CQRS rule -- nothing under modules/apps/
talks to the database directly, everything goes through the command
pipeline, which also gives audit rows and the deal.created event for
free).

stdlib-only (urllib): the scrapers' source clients already lean on
scrapling/curl_cffi where TLS fingerprinting matters; plain API POSTs
don't, and one fewer dependency in the hot path keeps this importable
from any venv. Transports stay injectable for tests.

Per-deal POST on purpose -- domain-api answers one 202 per command.
Failed pushes are reported, never raised up the whole cycle: a single
5xx shouldn't discard the other forty deals a poll just scraped.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Callable

from .model import RawDeal

log = logging.getLogger(__name__)


@dataclass
class PushResult:
    """One cycle's push outcome, per deal. runner.py turns these into
    the deals_pushed_total{outcome} metric."""

    deals: list[Any] = field(default_factory=list)  # everything seen this push
    accepted: list[Any] = field(default_factory=list)  # 202; domain-worker takes it from here
    rejected: list[Any] = field(default_factory=list)  # 4xx -- bad deal, counted and skipped
    failed: list[Any] = field(default_factory=list)  # 5xx/network exhausted -- retried next poll

    @property
    def ok(self) -> int:
        return len(self.accepted)


def _rfc3339(dt: datetime) -> str:
    """Go's time.Parse(time.RFC3339) wants the Z form; millisecond
    precision shrinks the wire without losing scrape fidelity. Naive
    datetimes are the model's documented UTC contract, not local time."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _upsert_body(deal: RawDeal) -> dict[str, Any]:
    """Keys are domain-api's deal.upsert UpsertInput; optional fields
    stay absent so the server-side pointers land as nil, mirroring the
    NULL columns the old direct-to-postgres writers left."""
    body: dict[str, Any] = {
        "source": deal.source,
        "source_deal_id": deal.source_deal_id,
        "title": deal.title,
        "url": deal.url,
        "scraped_at": _rfc3339(deal.scraped_at),
    }
    if deal.store is not None:
        body["store"] = deal.store
    if deal.price_cents is not None:
        body["price_cents"] = deal.price_cents
    if deal.old_price_cents is not None:
        body["old_price_cents"] = deal.old_price_cents
    if deal.posted_at is not None:
        body["posted_at"] = _rfc3339(deal.posted_at)
    if deal.payload:
        body["payload"] = deal.payload
    return body


class DealsClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        timeout_s: float = 10.0,
        min_interval_s: float = 0.25,
        max_retries: int = 3,
        urlopen: Callable[..., Any] | None = None,
        sleeper: Callable[[float], None] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_s = timeout_s
        self.min_interval_s = min_interval_s
        self.max_retries = max_retries
        self._open = urlopen or urllib.request.urlopen
        self._sleep = sleeper or time.sleep
        self._last_call = float("-inf")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "DealsClient":
        env = env if env is not None else os.environ
        missing = [name for name in ("DOMAIN_API_URL", "DOMAIN_API_KEY") if not env.get(name)]
        if missing:
            raise ValueError(f"missing required env: {', '.join(missing)}")
        return cls(env["DOMAIN_API_URL"], env["DOMAIN_API_KEY"])

    def _headers(self) -> dict[str, str]:
        headers = {
            "content-type": "application/json",
            "x-api-key": self.api_key,
        }
        try:
            # Make the POST /deals span a child of the scrape-cycle
            # span: one trace shows scrape -> push -> command processed.
            from opentelemetry import propagate

            propagate.inject(headers)
        except Exception:  # noqa: BLE001 — trace propagation is optional
            pass
        return headers

    def _pace(self) -> None:
        wait = self.min_interval_s - (time.monotonic() - self._last_call)
        if wait > 0:
            self._sleep(wait)
        self._last_call = time.monotonic()

    def push_deals(self, deals: list[RawDeal]) -> PushResult:
        result = PushResult(deals=list(deals))
        for deal in deals:
            outcome = self._push_one(deal)
            getattr(result, outcome).append(deal)
        if deals:
            log.info(
                "pushed %d deals as deal.upsert: %d accepted, %d rejected, %d failed",
                len(deals), len(result.accepted), len(result.rejected), len(result.failed),
            )
        return result

    def _push_one(self, deal: RawDeal) -> str:
        """One deal -> one POST. Returns accepted|rejected|failed."""
        body = json.dumps(_upsert_body(deal), ensure_ascii=False).encode("utf-8")
        last_error = "unknown error"
        for attempt in range(self.max_retries + 1):
            try:
                self._pace()
                req = urllib.request.Request(
                    f"{self.base_url}/deals",
                    data=body,
                    headers=self._headers(),
                    method="POST",
                )
                with self._open(req, timeout=self.timeout_s) as res:
                    if 200 <= res.status < 300:
                        return "accepted"
                    last_error = f"status {res.status}"
            except urllib.error.HTTPError as err:
                err.read()  # drain the body so sockets are reusable
                code = err.code
                if 400 <= code < 500 and code != 429:
                    log.debug("deal %s rejected (%s)", deal.source_deal_id, code)
                    return "rejected"
                last_error = f"status {code}"
                if code == 429:
                    self._sleep_retry(err.headers.get("retry-after"), attempt)
                    continue
            except Exception as err:  # noqa: BLE001 — network noise is per-deal
                last_error = f"{type(err).__name__}: {err}"
            self._sleep_retry(None, attempt)
        log.warning(
            "deal %s: push failed after %d attempts (%s)",
            deal.source_deal_id, self.max_retries + 1, last_error,
        )
        return "failed"

    def _sleep_retry(self, retry_after_header: str | None, attempt: int) -> None:
        delay = max(0.5 * 2**attempt, 0.5)
        if retry_after_header:
            try:
                delay = max(float(retry_after_header), delay)
            except ValueError:
                pass
        self._sleep(min(delay, 8.0))