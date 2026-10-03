"""``OccurredAt`` -- invariant §3.4-4: always tz-aware, stored in UTC.

A naive datetime is rejected instead of being assumed to be UTC. That
assumption is exactly how an "hoje" in São Paulo lands three hours off in
the ledger, and it is invisible in every test that runs in one timezone.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Final

UTC: Final = timezone.utc


class TimestampError(ValueError):
    """The timestamp is naive, malformed, or not a datetime."""


def parse_occurred_at(value: object, *, field: str = "occurred_at") -> datetime:
    """Return a tz-aware datetime normalised to UTC.

    Accepts a tz-aware ``datetime``, or an ISO-8601 string that carries an
    offset (``Z`` included). Anything else is an error.
    """
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise TimestampError(f"{field} must not be empty")
        # ``Z`` is valid ISO-8601 and common on the wire, but fromisoformat
        # only learned it in 3.11; normalise so the accepted set is one set.
        normalised = text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text
        try:
            moment = datetime.fromisoformat(normalised)
        except ValueError as exc:
            raise TimestampError(f"{field} is not valid ISO-8601: {value!r}") from exc
    else:
        raise TimestampError(f"{field} must be an ISO-8601 string or datetime")

    if moment.tzinfo is None or moment.tzinfo.utcoffset(moment) is None:
        raise TimestampError(
            f"{field} must be timezone-aware (invariant §3.4-4); got a naive "
            f"datetime. Send an offset, e.g. 2026-10-03T09:00:00-03:00"
        )
    return moment.astimezone(UTC)
