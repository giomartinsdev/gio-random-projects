from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flows.bus_gps_poller.schemas import BusPositionCapture
from flows.shared.transformer import Transformer


class BusPositionTransformer(Transformer[list[dict[str, Any]], list[BusPositionCapture]]):
    """Parses raw SPPO rows into typed captures, skipping (and logging)
    anything malformed rather than failing the whole batch — one bad
    row from a flaky upstream feed shouldn't drop every other vehicle's
    position for this poll."""

    def transform(self, data: list[dict[str, Any]]) -> list[BusPositionCapture]:
        captures: list[BusPositionCapture] = []
        for row in data:
            try:
                captures.append(self._parse(row))
            except (KeyError, ValueError, TypeError) as exc:
                self.logger.warning(f"skipping malformed SPPO row: {row!r} ({exc})")
        self.logger.info(f"Parsed {len(captures)}/{len(data)} rows")
        return captures

    @staticmethod
    def _parse(row: dict[str, Any]) -> BusPositionCapture:
        # lat/lon/velocidade use a comma decimal separator, datahora is
        # epoch milliseconds — confirmed against a live sample.
        latitude = float(str(row["latitude"]).replace(",", "."))
        longitude = float(str(row["longitude"]).replace(",", "."))
        speed_kmh = float(str(row.get("velocidade", "0")).replace(",", "."))
        captured_at = datetime.fromtimestamp(int(row["datahora"]) / 1000, tz=UTC)
        return BusPositionCapture(
            mode="sppo",
            line_code=str(row["linha"]),
            vehicle_id=str(row["ordem"]),
            latitude=latitude,
            longitude=longitude,
            speed_kmh=speed_kmh,
            captured_at=captured_at,
        )
