from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from flows.bus_gps_poller.schemas import BusPositionCapture
from flows.shared.transformer import Transformer

# Confirmed live: the feed's own `datetime` field carries a "Z" suffix
# (implying UTC) but the wall-clock value underneath is actually
# America/Sao_Paulo local time — e.g. a row fetched at 18:34 real UTC
# (15:34 in Rio) carries "...T15:33:59Z", not "...T18:33:59Z". Taking
# that "Z" at face value made every captured_at exactly 3 hours further
# in the past than reality, which silently pushed every single
# position outside bora-api's own freshness window (10 minutes) —
# confirmed live: real-time-correct data was landing, right down to
# the vehicle_id, but never showed up as "live" anywhere downstream.
_SPPO_TZ = ZoneInfo("America/Sao_Paulo")


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
        # .replace(tzinfo=...) twice, not once: the first strips the
        # feed's misleading "Z" (fromisoformat already attached UTC
        # because of it) without touching the wall-clock numbers, the
        # second re-labels those same numbers as the Sao Paulo time
        # they actually are — only then does .astimezone(UTC) do a real
        # conversion instead of a relabeling.
        captured_at = (
            datetime.fromisoformat(row["datetime"]).replace(tzinfo=_SPPO_TZ).astimezone(UTC)
        )
        return BusPositionCapture(
            mode="sppo",
            line_code=str(row["servico"]),
            vehicle_id=str(row["id_veiculo"]),
            latitude=latitude,
            longitude=longitude,
            speed_kmh=speed_kmh,
            captured_at=captured_at,
        )
