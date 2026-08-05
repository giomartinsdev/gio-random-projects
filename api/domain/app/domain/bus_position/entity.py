from app.domain.base import Document


class BusPosition(Document, table=True):
    """One GPS ping for one vehicle, verbatim as reported by
    dados.mobilidade.rio — kept as one JSONB blob (`data`, from
    `Document`) rather than exploded into typed columns, since the
    upstream feed's shape isn't ours to define a migration around. See
    flows/bus_gps_poller for what actually lands in `data`
    (mode/line_code/vehicle_id/latitude/longitude/speed_kmh/color_hex).
    """
