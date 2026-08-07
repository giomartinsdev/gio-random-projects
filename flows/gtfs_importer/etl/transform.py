from __future__ import annotations

from collections import defaultdict

from flows.gtfs_importer.schemas import GtfsCapture, LineCapture, RouteStopCapture, StopCapture
from flows.shared.transformer import Transformer

# Rio's own GTFS feed gives BRT no distinguishing route_type of its own
# (confirmed against a live sample: BRT routes carry the same route_type
# as regular buses) — route_id's own "BRT" prefix is the actual signal,
# same one brt_gps_poller's extractor already keys off for the live-GPS
# side of this system.
_BRT_PREFIX = "BRT"


class GtfsTransformer(Transformer[dict[str, list[dict[str, str]]], GtfsCapture]):
    """Shapes raw GTFS CSV rows into the three domain event payloads.
    Skips (and logs) any individually malformed row rather than failing
    the whole import — same "one bad row doesn't sink the batch"
    reasoning as BusPositionTransformer.

    GTFS gives no single canonical stop sequence per line/direction —
    different trips on the same route can vary (short-turns, branches),
    so RouteStop rows come from each (route_id, direction_id)'s trip
    with the most stop_times rows — the "fullest itinerary wins"
    heuristic a first-pass trip planner can build on, deferring anything
    more precise (e.g. picking the single most common pattern) to a
    later iteration.
    """

    def transform(self, data: dict[str, list[dict[str, str]]]) -> GtfsCapture:
        stops = self._stops(data.get("stops", []))
        lines = self._lines(data.get("routes", []))
        route_stops = self._route_stops(data.get("trips", []), data.get("stop_times", []))
        self.logger.info(
            f"Transformed {len(stops)} stops, {len(lines)} lines, "
            f"{len(route_stops)} route-stop rows"
        )
        return GtfsCapture(stops=stops, lines=lines, route_stops=route_stops)

    def _stops(self, rows: list[dict[str, str]]) -> list[StopCapture]:
        result: list[StopCapture] = []
        for row in rows:
            try:
                result.append(
                    StopCapture(
                        id=row["stop_id"],
                        name=row["stop_name"],
                        latitude=float(row["stop_lat"]),
                        longitude=float(row["stop_lon"]),
                    )
                )
            except (KeyError, ValueError) as exc:
                self.logger.warning(f"skipping malformed stop row: {row!r} ({exc})")
        return result

    def _lines(self, rows: list[dict[str, str]]) -> list[LineCapture]:
        result: list[LineCapture] = []
        for row in rows:
            try:
                route_id = row["route_id"]
                short_name = row.get("route_short_name") or ""
                long_name = row.get("route_long_name") or ""
                result.append(
                    LineCapture(
                        id=route_id,
                        code=short_name or route_id,
                        name=long_name or short_name or route_id,
                        mode="brt" if route_id.upper().startswith(_BRT_PREFIX) else "bus",
                    )
                )
            except KeyError as exc:
                self.logger.warning(f"skipping malformed route row: {row!r} ({exc})")
        return result

    def _route_stops(
        self, trips: list[dict[str, str]], stop_times: list[dict[str, str]]
    ) -> list[RouteStopCapture]:
        # trip_id -> (route_id, direction_id). direction_id defaults to
        # 0 — GTFS marks it optional, and a feed with no branching
        # service (single direction) legitimately omits it.
        trip_index: dict[str, tuple[str, int]] = {}
        for row in trips:
            try:
                trip_index[row["trip_id"]] = (row["route_id"], int(row.get("direction_id") or 0))
            except (KeyError, ValueError) as exc:
                self.logger.warning(f"skipping malformed trip row: {row!r} ({exc})")

        # Group stop_times by trip_id first — it's typically the
        # largest file in a GTFS feed by an order of magnitude, so every
        # later step works off this grouping instead of rescanning raw
        # rows for each candidate trip.
        by_trip: dict[str, list[dict[str, str]]] = defaultdict(list)
        for row in stop_times:
            trip_id = row.get("trip_id")
            if trip_id:
                by_trip[trip_id].append(row)

        # Per (route_id, direction_id), keep the trip_id with the most
        # stop_times rows — see class docstring for why.
        best_trip: dict[tuple[str, int], str] = {}
        for trip_id, rows in by_trip.items():
            key = trip_index.get(trip_id)
            if key is None:
                continue
            current_best = best_trip.get(key)
            if current_best is None or len(rows) > len(by_trip[current_best]):
                best_trip[key] = trip_id

        result: list[RouteStopCapture] = []
        for (route_id, direction_id), trip_id in best_trip.items():
            for row in by_trip[trip_id]:
                try:
                    result.append(
                        RouteStopCapture(
                            line_id=route_id,
                            stop_id=row["stop_id"],
                            direction_id=direction_id,
                            sequence=int(row["stop_sequence"]),
                        )
                    )
                except (KeyError, ValueError) as exc:
                    self.logger.warning(f"skipping malformed stop_time row: {row!r} ({exc})")
        return result
