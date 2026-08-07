"""Orchestration only. Prefect's @task wraps each ETL class call so every
stage shows up as its own task run in the UI (retries, caching, logs) —
the classes themselves stay Prefect-agnostic and unit-testable on their
own. Mirrors flows/bus_gps_poller/flow.py's own shape.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from prefect import flow, task

from flows.gtfs_importer.etl.extract import GtfsExtractor
from flows.gtfs_importer.etl.load import GatewayGtfsLoader
from flows.gtfs_importer.etl.transform import GtfsTransformer

if TYPE_CHECKING:
    from flows.gtfs_importer.schemas import GtfsCapture


@task(retries=3, retry_delay_seconds=30)
def extract() -> dict[str, list[dict[str, str]]]:
    return GtfsExtractor().extract()


@task
def transform(data: dict[str, list[dict[str, str]]]) -> GtfsCapture:
    return GtfsTransformer().transform(data)


@task(retries=2, retry_delay_seconds=30)
def load(data: GtfsCapture, gateway_url: str, api_key: str) -> None:
    GatewayGtfsLoader(gateway_url, api_key).load(data)


@flow(log_prints=True)
def gtfs_importer(
    gateway_url: str = "https://gateway.giomartins.dev",
    api_key: str = "",
) -> None:
    """Downloads the SMTR's GTFS feed and upserts Stop/Line rows plus
    each line's stop sequence (RouteStop) into the domain. Scheduled
    monthly (see prefect.yaml) to match the feed's own update cadence —
    a tighter schedule would just re-import identical data."""
    raw = extract()
    capture = transform(raw)
    load(capture, gateway_url, api_key)


if __name__ == "__main__":
    gtfs_importer()
