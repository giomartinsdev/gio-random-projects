"""Uploads the archived rows to MinIO and deletes them from Postgres —
both through the gateway's generic domain events (object_storage's
PutObject, vehicle_position's DeleteVehiclePositionHistoryBatch), since
the domain itself no longer knows anything about archiving policy — see
api/domain/app/domain/vehicle_position/history_events.py's module
docstring.
"""

from __future__ import annotations

import base64
import time

import httpx

from flows.shared.loader import Loader
from flows.vehicle_position_archiver.schemas import ArchivePlan

# ids go out as repeated query params on a DELETE request, not a JSON
# body (api/domain's router_factory.py binds GET/DELETE payloads as
# query params) — a very large overflow batch is chunked rather than
# risking one oversized URL, same reasoning as api/domain's
# RecordVehiclePositions._CHUNK_SIZE.
_DELETE_CHUNK_SIZE = 500

_TOO_MANY_REQUESTS = 429
# A backlog built up over hours of a broken MinIO connection needs
# hundreds of delete-batch requests in one run — comfortably past the
# gateway's own rate limit (GATEWAY_RATE_LIMIT, 120/minute by default).
# Confirmed live: a real archive run crashed on the first 429 with no
# retry at all. The gateway's Retry-After header (see api/gateway's
# main.py, headers_enabled=True) says exactly how long the current
# window has left; a fixed number of retries bounds how long one run
# will keep waiting out repeated windows before giving up for real.
_MAX_RATE_LIMIT_RETRIES = 10


def _chunks[T](items: list[T], size: int) -> list[list[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


class GatewayArchiveLoader(Loader[ArchivePlan]):
    def __init__(
        self, gateway_url: str, api_key: str, bucket: str, client: httpx.Client | None = None
    ) -> None:
        super().__init__()
        self._base_url = gateway_url.rstrip("/")
        self._client = client or httpx.Client(timeout=120.0)
        self._headers = {"X-API-Key": api_key}
        self._bucket = bucket

    def _request(self, method: str, path: str, **kwargs: object) -> httpx.Response:
        url = f"{self._base_url}{path}"
        for attempt in range(_MAX_RATE_LIMIT_RETRIES):
            response = self._client.request(method, url, headers=self._headers, **kwargs)  # pyright: ignore[reportArgumentType] — **kwargs here is always httpx's own json=/params= keyword args, not arbitrary object values
            if response.status_code != _TOO_MANY_REQUESTS:
                response.raise_for_status()
                return response
            retry_after = float(response.headers.get("Retry-After", 60))
            self.logger.warning(
                f"Rate limited on {path} (attempt {attempt + 1}/{_MAX_RATE_LIMIT_RETRIES}), "
                f"waiting {retry_after:.0f}s"
            )
            time.sleep(retry_after)
        # Last attempt, no more retries left — let a persistent 429
        # surface as a real failure instead of silently giving up.
        response = self._client.request(method, url, headers=self._headers, **kwargs)  # pyright: ignore[reportArgumentType] — see the loop's own call above
        response.raise_for_status()
        return response

    def load(self, data: ArchivePlan) -> None:
        if data.object_key is None:
            self.logger.info("Nothing to archive, skipping the gateway entirely")
            return

        # Idempotent — safe to call every run instead of requiring the
        # bucket to already exist via some out-of-band MinIO setup step.
        self._request("POST", "/events/create-bucket", json={"bucket": self._bucket})

        self._request(
            "PUT",
            "/events/put-object",
            json={
                "bucket": self._bucket,
                "key": data.object_key,
                "data_base64": base64.b64encode(data.parquet_bytes).decode("ascii"),
                "content_type": "application/octet-stream",
            },
        )

        deleted = 0
        for chunk in _chunks(data.archived_ids, _DELETE_CHUNK_SIZE):
            response = self._request(
                "DELETE", "/events/delete-vehicle-position-history-batch", params={"ids": chunk}
            )
            deleted += response.json()

        self.logger.info(f"Archived {deleted} rows to {self._bucket}/{data.object_key}")
