"""bora-api configuration, read once from the environment.

No auth, rate-limit, or CORS settings here on purpose: this service is
reached only via the gateway's own public routes (see
api/gateway/app/main.py's proxy_nearby_stops/proxy_trip_options/
proxy_geocode), never exposed on its own — same trust relationship
`domain` already has with the gateway. Auth, per-IP rate limiting, and
CORS all live on the gateway, the one thing actually facing the
internet.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BORA_API_")

    gateway_url: str = "http://gateway:8000"
    gateway_api_key: str = ""
    request_timeout_seconds: float = 30.0
    # Stop/Line/RouteStop only change when flows/gtfs_importer reimports
    # (monthly) — a fresh domain round-trip on every request would be
    # pure waste, so ReferenceDataCache holds them for this long between
    # refreshes.
    reference_data_ttl_seconds: float = 600.0
    default_radius_m: float = 800.0
    # 5 was tuned against sparse test fixtures; a real city-wide GTFS
    # feed clusters many stops (different operators/routes) within the
    # same 800m radius, so 5 nearest stops on each side missed direct
    # lines that a slightly wider window finds (confirmed live: Centro
    # -> Copacabana had 0 matches at limit=5 but 69 at limit=20).
    default_stop_limit: int = 20
    # ~4.7 km/h — a commonly used average adult walking pace.
    walking_speed_mps: float = 1.3
    # Floor applied to a bus's own reported speed before dividing
    # distance by it — a bus reading near-zero (stopped in traffic, at a
    # stop) would otherwise blow ETA up toward infinity instead of just
    # "a while."
    min_bus_speed_kmh: float = 5.0
    # Assumed average city-bus speed (accounting for stops/traffic),
    # used only for the trip-duration estimate — not the ETA-to-stop
    # calculation, which uses each vehicle's own live speed instead. See
    # TripPlanner's own docstring for why this is a rough estimate, not
    # a scheduled-time lookup.
    average_bus_speed_kmh: float = 18.0
    # Flat estimate of time lost stepping off the first bus, walking to
    # the second one's stop, and waiting for it — see TripPlanner's own
    # docstring for why this isn't per-stop dwell/headway data.
    transfer_buffer_seconds: float = 180.0


settings = Settings()
