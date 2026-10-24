"""``X-API-Key`` enforcement, mirroring domain-api's ``Secure`` middleware.

Same header, same semantics, same reason: each caller (the WhatsApp worker,
and later the Open Finance connector) gets its own key so the audit trail
can name who asked (§12.3). What is logged is the key's **label**, never
the key -- a key in a log line is a key in Loki forever.
"""

from __future__ import annotations

import hmac
from typing import Final, Mapping

from finance_api.domain.errors import UnauthorizedError

API_KEY_HEADER: Final = "X-API-Key"


def authenticate(headers: Mapping[str, str], keys: Mapping[str, str]) -> str:
    """Return the caller's label, or raise ``UnauthorizedError``.

    A missing header and an unknown key are deliberately the same answer:
    telling a prober which of the two it was is free information.
    """
    presented = _header(headers, API_KEY_HEADER)
    if presented is None:
        raise UnauthorizedError("missing or invalid API key")

    # ``hmac.compare_digest`` over each candidate: a plain dict lookup on the
    # raw key leaks timing, and this runs per request. The key count is
    # small (one per service), so the loop is cheap.
    for key, label in keys.items():
        if hmac.compare_digest(presented, key):
            return label
    raise UnauthorizedError("missing or invalid API key")


def _header(headers: Mapping[str, str], name: str) -> str | None:
    """Case-insensitive header read.

    Starlette's Headers is already case-insensitive, but the tests pass
    plain dicts, and this keeps both honest.
    """
    getter = getattr(headers, "get", None)
    if getter is not None:
        direct = getter(name)
        if direct:
            return direct
    for candidate, value in headers.items():
        if candidate.lower() == name.lower() and value:
            return value
    return None
