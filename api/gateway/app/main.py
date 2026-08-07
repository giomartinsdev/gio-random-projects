# FastAPI route handlers nested inside create_app() below are only ever
# invoked via the @app.get/@app.api_route decorator, never referenced by
# name — invisible to reportUnusedFunction's static analysis.
#
# slowapi ships no type stubs pyright can find, same category of gap as
# pyarrow elsewhere in this repo (see flows/vehicle_position_archiver's
# etl/transform.py) — reportUnknownMemberType/reportUntypedFunctionDecorator on
# @limiter.limit(...) below are both intrinsic to that, not a real typing
# gap on our side.
# pyright: reportUnusedFunction=false, reportUnknownMemberType=false, reportUntypedFunctionDecorator=false

from __future__ import annotations

from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import TYPE_CHECKING

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    Response,  # noqa: TC002 — FastAPI resolves route return-type annotations at runtime (get_type_hints), so this can't be TYPE_CHECKING-only
)
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_ipaddr

from app.auth import require_api_key
from app.config import settings
from app.proxy import forward

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable


def _rate_limit_key(request: Request) -> str:
    # Keyed by the caller's own API key when there is one (the
    # authenticated, catch-all surface) — every such caller sits behind
    # Cloudflare's edge IPs, so IP-based limiting there would either
    # throttle every client together or none of them. The public
    # bora-api-facing routes below carry no API key at all (anonymous
    # browsers), so that surface falls back to get_ipaddr — which,
    # unlike slowapi's own get_remote_address, reads X-Forwarded-For
    # (set by Cloudflare in production; absent in local dev, where
    # request.client.host is already correct) instead of always seeing
    # this gateway's own upstream hop as the "client".
    return request.headers.get("x-api-key") or get_ipaddr(request)


# headers_enabled — a rate-limited response includes Retry-After (and
# X-RateLimit-*), so a well-behaved bulk caller (flows/vehicle_position_archiver,
# which can legitimately need hundreds of requests for one archive pass
# after a backlog builds up) knows exactly how long to back off instead
# of guessing. Confirmed live: without this, a 429 carried no signal at
# all, and that flow's own retry had no better option than crashing.
limiter = Limiter(key_func=_rate_limit_key, headers_enabled=True)


# Module-level, not nested inside create_app() — @limiter.limit(...)
# registers this function's rate limit against `limiter`'s own internal
# state, keyed by the function's qualname. create_app() runs fresh per
# test (see app/tests/test_proxy.py's gateway_client fixture) to swap in
# a fake transport; nesting this def there would re-run the decorator,
# and hence re-register another limit under the same key, every single
# time — confirmed by testing that this silently made rate limiting N
# times stricter than configured after N create_app() calls, since
# slowapi checks (and counts a hit against) every registered limit for
# that key, not just the most recent one.
#
# A callable, not settings.rate_limit itself — plain string would freeze
# the limit at whatever settings.rate_limit was when this module was
# first imported. slowapi re-invokes a callable limit on every request
# instead, which is also what lets tests override settings.rate_limit
# per-test via monkeypatch.
@limiter.limit(lambda: settings.rate_limit)
async def proxy_all(request: Request, path: str) -> Response:
    return await forward(request, request.app.state.http_client, settings.upstream_url, path)


# Three explicit routes, not a second catch-all — a wildcard proxy to
# bora-api would be just as unauthenticated as the paths it's meant to
# expose, silently turning into an open unauthenticated proxy to
# whatever bora-api happens to expose next. Each one forwards to the
# identical path on bora-api (see bora-api/app/main.py) — this gateway
# is doing pure routing here, no path translation. Module-level for the
# same re-registration reason as proxy_all above.
@limiter.limit(lambda: settings.rate_limit)
async def proxy_nearby_stops(request: Request) -> Response:
    return await forward(
        request, request.app.state.http_client, settings.bora_api_upstream_url, "nearby-stops"
    )


@limiter.limit(lambda: settings.rate_limit)
async def proxy_trip_options(request: Request) -> Response:
    return await forward(
        request, request.app.state.http_client, settings.bora_api_upstream_url, "trip-options"
    )


@limiter.limit(lambda: settings.rate_limit)
async def proxy_geocode(request: Request) -> Response:
    return await forward(
        request, request.app.state.http_client, settings.bora_api_upstream_url, "geocode"
    )


@limiter.limit(lambda: settings.rate_limit)
async def proxy_line_vehicles(request: Request) -> Response:
    return await forward(
        request, request.app.state.http_client, settings.bora_api_upstream_url, "line-vehicles"
    )


def _make_lifespan(
    transport: httpx.AsyncBaseTransport | None,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        async with httpx.AsyncClient(
            timeout=settings.request_timeout_seconds, transport=transport
        ) as client:
            app.state.http_client = client
            yield

    return lifespan


def create_app(transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    """transport is only ever set by tests — it swaps the real network
    transport for an in-process ASGI one pointed at a fake upstream, so
    proxy behavior can be tested without a real second server running."""
    app = FastAPI(title="Gateway", lifespan=_make_lifespan(transport))
    app.state.limiter = limiter
    # Only relevant to the public bora-api-facing routes below — a browser
    # calling the authenticated catch-all would need an X-API-Key header
    # on the request anyway, which no real frontend should ever hold, so
    # a permissive CORS policy here doesn't loosen anything on that side.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.parsed_cors_origins,
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    # slowapi's own handler is typed against its RateLimitExceeded, not
    # FastAPI's generic ExceptionHandler signature — this is the
    # documented way to wire it in (slowapi has no FastAPI-flavored
    # overload of its own), so the mismatch is on slowapi's stubs, not a
    # real handler-signature bug.
    app.add_exception_handler(
        RateLimitExceeded,
        _rate_limit_exceeded_handler,  # pyright: ignore[reportArgumentType]
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    # Registered before the catch-all on purpose — Starlette matches
    # routes in registration order, not by specificity, so these literal
    # paths have to come first or proxy_all's `/{path:path}` would
    # swallow them (and demand an API key no browser caller has).
    app.add_api_route("/nearby-stops", proxy_nearby_stops, methods=["GET"])
    app.add_api_route("/trip-options", proxy_trip_options, methods=["GET"])
    app.add_api_route("/geocode", proxy_geocode, methods=["GET"])
    app.add_api_route("/line-vehicles", proxy_line_vehicles, methods=["GET"])

    app.add_api_route(
        "/{path:path}",
        proxy_all,
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        dependencies=[Depends(require_api_key)],
    )

    return app


app = create_app()
