"""Request/response models of the ACL's own HTTP surface.

The request body is the **same** ``{action, payload}`` envelope the worker
speaks, so the worker has one shape to learn on both sides of the boundary
(spec §4.1).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# Bounds on the free-form payload: this is where untrusted input from the
# worker's NLU layer first meets a schema. The values themselves are
# validated by the domain models; here we only stop an oversized or
# wrong-shaped body before it is parsed any further.
PAYLOAD_MAX_BYTES = 64 * 1024


class CommandRequest(BaseModel):
    """``{"action": ..., "payload": {...}}`` -- the house envelope."""

    action: str = Field(min_length=1, max_length=128)
    payload: dict[str, Any] = Field(default_factory=dict)


class AcceptedResponse(BaseModel):
    """The documented ``202`` body of an asynchronous write door.

    Used by the outbound client's ``AcceptedResult`` counterpart; the route
    stops emitting 202 until ``domain-api`` grows an async envelope door
    (see CommandRouter), so this stays the shape we will emit then.
    """

    command_id: str
    status: str = "accepted"


class RelayResponse(BaseModel):
    """The relayed outcome. ``entity_id``/``error`` appear when they apply."""

    command_id: str
    status: str
    entity_id: str | None = None
    error: str | None = None
    relay: str | None = None


class ErrorResponse(BaseModel):
    error: str


class HealthResponse(BaseModel):
    status: str
