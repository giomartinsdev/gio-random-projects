"""A real, standalone upstream HTTP server for gateway integration tests.

Runs inside a python:3.12-alpine testcontainer (see conftest.py's
upstream_container fixture) — the gateway under test talks to this over
a real TCP socket across the container boundary, not an in-process
ASGI transport, so proxy.py's header stripping, query-param forwarding,
and body streaming are all exercised exactly as they'd run against a
real second service. Stdlib-only (http.server) so the container needs
no pip install step, just the base image already cached for CI.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: object) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/events/get-user":
            query = parse_qs(parsed.query)
            self._send_json(
                200,
                {
                    "seen_query_id": query.get("id", [None])[0],
                    "saw_api_key_header": self.headers.get("x-api-key"),
                },
            )
            return
        # Stands in for bora-api's own /nearby-stops, /trip-options,
        # /geocode in gateway's public-route tests (see
        # public_routes.feature) — this same fake server plays both
        # "domain" and "bora-api" upstream roles, since all the gateway
        # needs proven here is that it forwards to the right place
        # without requiring an API key.
        if parsed.path in (
            "/nearby-stops",
            "/trip-options",
            "/geocode",
            "/line-vehicles",
        ):
            self._send_json(
                200, {"path": parsed.path, "saw_api_key_header": self.headers.get("x-api-key")}
            )
            return
        self._send_json(404, {"detail": "not found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/events/create-user":
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            self._send_json(200, {"created": payload["name"]})
            return
        self._send_json(404, {"detail": "not found"})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/events/delete-batch":
            query = parse_qs(parsed.query)
            self._send_json(200, {"seen_ids": query.get("ids", [])})
            return
        self._send_json(404, {"detail": "not found"})

    def log_message(self, format: str, *args: object) -> None:  # noqa: ARG002 — silences BaseHTTPRequestHandler's default stderr access log, which would otherwise spam the test container's log output on every request
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8000), Handler)  # noqa: S104 — binds inside an isolated test container, not the host network
    server.serve_forever()
