"""Forwards an inbound request to the upstream API, as-is (method, path,
query string, body) minus the headers that shouldn't cross a proxy hop.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException
from fastapi.responses import Response

from app.config import settings

if TYPE_CHECKING:
    import httpx
    from fastapi import Request

# Headers that are either connection-specific (never meaningful past a
# proxy hop) or gateway-internal (the credential that got this request
# past auth.py — the upstream API has no business seeing it, and doesn't
# need to: the gateway already vouched for the caller).
_STRIPPED_REQUEST_HEADERS = {
    "host",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "x-api-key",
}
_STRIPPED_RESPONSE_HEADERS = {
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "connection",
}


async def _read_body_within_limit(request: Request, max_bytes: int) -> bytes:
    # A trusted Content-Length lets us reject oversized requests before
    # reading anything, but it's not load-bearing for the cap itself —
    # it can be absent (chunked transfer) or simply wrong, so the actual
    # enforcement below counts bytes as they're streamed off the wire
    # rather than trusting the header.
    content_length = request.headers.get("content-length")
    if content_length is not None and content_length.isdigit() and int(content_length) > max_bytes:
        raise HTTPException(status_code=413, detail="Request body too large")

    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail="Request body too large")
        chunks.append(chunk)
    return b"".join(chunks)


async def forward(
    request: Request, client: httpx.AsyncClient, upstream_url: str, path: str
) -> Response:
    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _STRIPPED_REQUEST_HEADERS
    }
    body = await _read_body_within_limit(request, settings.max_body_bytes)

    upstream_response = await client.request(
        method=request.method,
        url=f"{upstream_url}/{path}",
        params=request.query_params,
        headers=headers,
        content=body,
    )

    response_headers = {
        k: v
        for k, v in upstream_response.headers.items()
        if k.lower() not in _STRIPPED_RESPONSE_HEADERS
    }
    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=response_headers,
    )
