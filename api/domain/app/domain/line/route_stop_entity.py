from sqlmodel import Field

from app.domain.base import Entity


class RouteStop(Entity, table=True):
    """One row in a line's stop sequence — which stops a line visits, in
    what order, per direction. Autoincrement id: unlike Stop/Line, GTFS
    gives this mapping no stable natural key of its own (a route/
    direction/sequence triple isn't unique across a monthly reimport the
    way a stop_id or route_id is), so route_stop_events.py replaces a
    line's whole set on reimport instead of upserting row-by-row — see
    ReplaceRouteStops.
    """

    line_id: str = Field(foreign_key="line.id", index=True)
    stop_id: str = Field(foreign_key="stop.id", index=True)
    direction_id: int
    sequence: int
