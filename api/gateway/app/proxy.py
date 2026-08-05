"""Forwards an inbound request to the upstream API, as-is (method, path,
query string, body) minus the headers that shouldn't cross a proxy hop.
"""

from __future__ import annotations

import httpx
from fastapi import Request
from fastapi.responses import Response

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
_STRIPPED_RESPONSE_HEADERS = {"content-encoding", "content-length", "transfer-encoding", "connection"}


async def forward(request: Request, client: httpx.AsyncClient, upstream_url: str, path: str) -> Response:
    headers = {k: v for k, v in request.headers.items() if k.lower() not in _STRIPPED_REQUEST_HEADERS}
    body = await request.body()

    upstream_response = await client.request(
        method=request.method,
        url=f"{upstream_url}/{path}",
        params=request.query_params,
        headers=headers,
        content=body,
    )

    response_headers = {
        k: v for k, v in upstream_response.headers.items() if k.lower() not in _STRIPPED_RESPONSE_HEADERS
    }
    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=response_headers,
    )
