"""Uploads the archived rows to MinIO and deletes them from Postgres —
both through the gateway's generic domain events (object_storage's
PutObject, vehicle_position's DeleteVehiclePositionHistoryBatch), since
the domain itself no longer knows anything about archiving policy — see
api/domain/app/domain/vehicle_position/history_events.py's module
docstring.
"""

from __future__ import annotations

import base64

import httpx

from flows.shared.loader import Loader
from flows.vehicle_position_archiver.schemas import ArchivePlan

# ids go out as repeated query params on a DELETE request, not a JSON
# body (api/domain's router_factory.py binds GET/DELETE payloads as
# query params) — a very large overflow batch is chunked rather than
# risking one oversized URL, same reasoning as api/domain's
# RecordVehiclePositions._CHUNK_SIZE.
_DELETE_CHUNK_SIZE = 500


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

    def load(self, data: ArchivePlan) -> None:
        if data.object_key is None:
            self.logger.info("Nothing to archive, skipping the gateway entirely")
            return

        # Idempotent — safe to call every run instead of requiring the
        # bucket to already exist via some out-of-band MinIO setup step.
        self._client.post(
            f"{self._base_url}/events/create-bucket",
            json={"bucket": self._bucket},
            headers=self._headers,
        ).raise_for_status()

        self._client.put(
            f"{self._base_url}/events/put-object",
            json={
                "bucket": self._bucket,
                "key": data.object_key,
                "data_base64": base64.b64encode(data.parquet_bytes).decode("ascii"),
                "content_type": "application/octet-stream",
            },
            headers=self._headers,
        ).raise_for_status()

        deleted = 0
        for chunk in _chunks(data.archived_ids, _DELETE_CHUNK_SIZE):
            response = self._client.delete(
                f"{self._base_url}/events/delete-vehicle-position-history-batch",
                params={"ids": chunk},
                headers=self._headers,
            )
            response.raise_for_status()
            deleted += response.json()

        self.logger.info(f"Archived {deleted} rows to {self._bucket}/{data.object_key}")
