"""Same class-based, Prefect-agnostic shape as flows/bus_gps_poller
(etl/ + a thin @task wrapper), just with only a Load stage: all the
actual work (prune-to-10-per-vehicle, write Parquet, upload to MinIO)
happens in the domain API's own ArchiveVehiclePositionHistory.handle()
— this flow only exists to dispatch that event on a schedule, so
there's nothing to extract or transform.
"""

from __future__ import annotations

from prefect import flow, task

from flows.vehicle_position_archiver.etl.load import GatewayArchiveLoader


@task(retries=3, retry_delay_seconds=30)
def load(gateway_url: str, api_key: str) -> None:
    GatewayArchiveLoader(gateway_url, api_key).load(None)


@flow(log_prints=True)
def vehicle_position_archiver(
    gateway_url: str = "https://gateway.giomartins.dev",
    api_key: str = "",
) -> None:
    """Dispatches ArchiveVehiclePositionHistory hourly — prunes
    VehiclePositionHistory down to the 10 most recent rows per vehicle,
    archiving the rest to Parquet on MinIO (see
    api/domain/app/domain/vehicle_position/archive_events.py).
    Independent of how often positions are actually recorded
    (bus_gps_poller, brt_gps_poller both write to the same table) —
    this just keeps it bounded regardless of their cadence."""
    load(gateway_url, api_key)


if __name__ == "__main__":
    vehicle_position_archiver()
