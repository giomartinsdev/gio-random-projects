from __future__ import annotations

from datetime import datetime
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
        # lat/lon/velocidade tolerate either a comma-decimal string (the
        # feed's old shape) or a plain float (its current one) — str()
        # on an already-parsed float never contains a comma, so
        # .replace(",", ".") is a harmless no-op either way. linha/
        # ordem/datahora (epoch-ms) are gone from the live feed as of
        # this fix — confirmed live: the feed now sends servico/
        # id_veiculo/datetime (ISO 8601) instead, and the old field
        # names silently dropped nearly every row of every poll as
        # "malformed" (355 lines' worth of real vehicles in a live
        # sample, only a handful surviving by coincidence). datetime,
        # not datetime_envio or datetime_servidor, matches this field's
        # original semantics — when the vehicle's GPS actually captured
        # the position, not when SPPO's own pipeline touched it.
        latitude = float(str(row["latitude"]).replace(",", "."))
        longitude = float(str(row["longitude"]).replace(",", "."))
        speed_kmh = float(str(row.get("velocidade", "0")).replace(",", "."))
        captured_at = datetime.fromisoformat(row["datetime"])
        return BusPositionCapture(
            mode="sppo",
            line_code=str(row["servico"]),
            vehicle_id=str(row["id_veiculo"]),
            latitude=latitude,
            longitude=longitude,
            speed_kmh=speed_kmh,
            captured_at=captured_at,
        )
