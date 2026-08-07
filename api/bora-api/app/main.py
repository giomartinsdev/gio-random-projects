# FastAPI route handlers nested inside create_app() below are only ever
# invoked via the @app.get decorator, never referenced by name —
# invisible to reportUnusedFunction's static analysis. Same pattern as
# api/gateway/app/main.py's own health().
# pyright: reportUnusedFunction=false

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI, Query
from pydantic import BaseModel

from app.cache import ReferenceDataCache
from app.config import settings
from app.domain_client import DomainClient
from app.geocoding import NominatimGeocoder
from app.trip_planner import TripPlanner

# Module-level singletons — a fresh TripPlanner per request would mean a
# fresh (cache-less) ReferenceDataCache every time, defeating the whole
# point of caching Stop/Line/RouteStop across requests. Tests override
# these via app.dependency_overrides instead of touching this
# construction (see app/tests/steps/test_main_steps.py).
_domain_client = DomainClient(settings.gateway_url, settings.gateway_api_key)
_cache = ReferenceDataCache(_domain_client, settings.reference_data_ttl_seconds)
_planner = TripPlanner(
    _domain_client,
    _cache,
    walking_speed_mps=settings.walking_speed_mps,
    min_bus_speed_kmh=settings.min_bus_speed_kmh,
    average_bus_speed_kmh=settings.average_bus_speed_kmh,
)
_geocoder = NominatimGeocoder()


def get_trip_planner() -> TripPlanner:
    return _planner


def get_geocoder() -> NominatimGeocoder:
    return _geocoder


class NearbyStopResponse(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    distance_m: float
    walk_seconds: float


class TripOptionResponse(BaseModel):
    line_id: str
    line_code: str
    line_name: str
    origin_stop_id: str
    origin_stop_name: str
    destination_stop_id: str
    destination_stop_name: str
    walk_seconds: float
    trip_seconds: float
    vehicle_id: str | None
    eta_seconds: float | None


class GeocodeResponse(BaseModel):
    name: str
    latitude: float
    longitude: float


def create_app() -> FastAPI:
    app = FastAPI(title="bora-api")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/nearby-stops")
    def nearby_stops(
        planner: Annotated[TripPlanner, Depends(get_trip_planner)],
        lat: float = Query(...),
        lon: float = Query(...),
        radius_m: float = Query(default=settings.default_radius_m, gt=0),
        limit: int = Query(default=settings.default_stop_limit, gt=0),
    ) -> list[NearbyStopResponse]:
        return [
            NearbyStopResponse(
                id=nearby.stop.id,
                name=nearby.stop.name,
                latitude=nearby.stop.latitude,
                longitude=nearby.stop.longitude,
                distance_m=nearby.distance_m,
                walk_seconds=nearby.walk_seconds,
            )
            for nearby in planner.nearby_stops(lat, lon, radius_m, limit)
        ]

    @app.get("/trip-options")
    def trip_options(
        planner: Annotated[TripPlanner, Depends(get_trip_planner)],
        from_lat: float = Query(...),
        from_lon: float = Query(...),
        to_lat: float = Query(...),
        to_lon: float = Query(...),
        radius_m: float = Query(default=settings.default_radius_m, gt=0),
        stop_limit: int = Query(default=settings.default_stop_limit, gt=0),
    ) -> list[TripOptionResponse]:
        options = planner.trip_options(
            from_lat, from_lon, to_lat, to_lon, radius_m=radius_m, stop_limit=stop_limit
        )
        return [
            TripOptionResponse(
                line_id=option.line_id,
                line_code=option.line_code,
                line_name=option.line_name,
                origin_stop_id=option.origin_stop_id,
                origin_stop_name=option.origin_stop_name,
                destination_stop_id=option.destination_stop_id,
                destination_stop_name=option.destination_stop_name,
                walk_seconds=option.walk_seconds,
                trip_seconds=option.trip_seconds,
                vehicle_id=option.vehicle_id,
                eta_seconds=option.eta_seconds,
            )
            for option in options
        ]

    @app.get("/geocode")
    def geocode(
        geocoder: Annotated[NominatimGeocoder, Depends(get_geocoder)],
        q: str = Query(..., min_length=2),
        limit: int = Query(default=5, gt=0),
    ) -> list[GeocodeResponse]:
        return [
            GeocodeResponse(name=result.name, latitude=result.latitude, longitude=result.longitude)
            for result in geocoder.search(q, limit)
        ]

    return app


app = create_app()
