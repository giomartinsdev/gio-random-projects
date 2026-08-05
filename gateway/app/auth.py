"""API key authentication — the credentialing the gateway is responsible
for. Nothing reaches proxy.py without passing through here first.
"""

from __future__ import annotations

from fastapi import Header, HTTPException

from app.config import settings


def require_api_key(x_api_key: str | None = Header(default=None)) -> str:
    """FastAPI dependency: returns the calling client's name on success,
    raises 401 otherwise. Wire into a route with `Depends(require_api_key)`.
    """
    if x_api_key is None:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")

    client = settings.parsed_api_keys.get(x_api_key)
    if client is None:
        raise HTTPException(status_code=401, detail="Invalid API key")

    return client
