from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flows.brt_gps_poller.schemas import BusPositionCapture
from flows.shared.transformer import Transformer


class BrtPositionTransformer(Transformer[list[dict[str, Any]], list[BusPositionCapture]]):
    """Parses raw BRT rows into typed captures, skipping (and logging)
    anything malformed rather than failing the whole batch — one bad
    row from a flaky upstream feed shouldn't drop every other vehicle's
    position for this poll."""

    def transform(self, data: list[dict[str, Any]]) -> list[BusPositionCapture]:
        captures: list[BusPositionCapture] = []
        for row in data:
            try:
                captures.append(self._parse(row))
            except (KeyError, ValueError, TypeError) as exc:
                self.logger.warning(f"skipping malformed BRT row: {row!r} ({exc})")
        self.logger.info(f"Parsed {len(captures)}/{len(data)} rows")
        return captures

    @staticmethod
    def _parse(row: dict[str, Any]) -> BusPositionCapture:
        # Unlike SPPO, lat/lon/velocidade are already numeric here (no
        # comma decimal to strip), and the vehicle identifier field is
        # "codigo", not "ordem" — confirmed against a live sample.
        latitude = float(row["latitude"])
        longitude = float(row["longitude"])
        speed_kmh = float(row.get("velocidade", 0))
        captured_at = datetime.fromtimestamp(int(row["dataHora"]) / 1000, tz=UTC)
        return BusPositionCapture(
            mode="brt",
            line_code=str(row["linha"]),
            vehicle_id=str(row["codigo"]),
            latitude=latitude,
            longitude=longitude,
            speed_kmh=speed_kmh,
            captured_at=captured_at,
        )
