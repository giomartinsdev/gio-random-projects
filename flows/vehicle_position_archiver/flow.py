"""Not an ETL pipeline — a periodic trigger. See flows/README.md's
"When a flow isn't ETL" note (same reasoning as user_crud_test): all
the actual work (prune-to-10-per-vehicle, write Parquet, upload to
MinIO) happens in the domain API's own
ArchiveVehiclePositionHistory.handle() — this flow only exists to
dispatch that event on a schedule.
"""

from __future__ import annotations

from prefect import flow, task

from flows.shared.logger import get_logger
from flows.vehicle_position_archiver.client import GatewayClient

logger = get_logger(__name__)


@task(retries=3, retry_delay_seconds=30)
def archive(gateway_url: str, api_key: str) -> int:
    return GatewayClient(gateway_url, api_key).archive_vehicle_position_history()


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
    archived = archive(gateway_url, api_key)
    logger.info(f"Archived {archived} old position-history rows")


if __name__ == "__main__":
    vehicle_position_archiver()
