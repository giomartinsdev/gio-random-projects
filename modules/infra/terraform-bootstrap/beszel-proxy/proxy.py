#!/usr/bin/env python3
"""Sits between beszel.giomartins.dev (cloudflared) and beszel-hub,
both on gio-server. Same underlying cause as
modules/infra/terraform-bootstrap/docker-api-proxy: the Cloudflare
Tunnel's HTTP/2->1.1 translation mangles bodyless POST requests — here
it leaves a stray/empty Content-Type header on
POST /api/collections/users/auth-refresh (no body, just an
Authorization header), which PocketBase's content-type parser then
rejects outright with "Unsupported Content-Type" (400). Confirmed
live: the exact same request against beszel-hub directly, bypassing
the tunnel, succeeds. Strips Content-Type on any bodyless request and
passes every other request through untouched.

Listens on 127.0.0.1:8091 (where cloudflared's ingress rule for
beszel.giomartins.dev points); beszel-hub itself listens on
its own container's 8090, reachable by name over the shared docker
network both containers join.
"""

import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM_HOST = "beszel-hub"
UPSTREAM_PORT = 8090
LISTEN_PORT = 8091

HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"}


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _proxy(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP and k.lower() != "content-length"}
        if body:
            headers["Content-Length"] = str(len(body))
        else:
            # A bodyless request has nothing for a Content-Type to
            # describe — whatever the tunnel left here (confirmed:
            # sometimes present but empty/malformed) only confuses
            # PocketBase's parser.
            headers.pop("Content-Type", None)
            headers.pop("content-type", None)

        conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT)
        try:
            conn.request(self.command, self.path, body=body or None, headers=headers)
            upstream_resp = conn.getresponse()
            resp_body = upstream_resp.read()

            self.send_response(upstream_resp.status)
            for k, v in upstream_resp.getheaders():
                if k.lower() not in HOP_BY_HOP and k.lower() != "content-length":
                    self.send_header(k, v)
            # http.client's .read() already de-chunks a
            # Transfer-Encoding: chunked upstream response into a plain
            # bytes object — but since that header (and any original
            # Content-Length) got dropped above, HTTP/1.1 requires an
            # explicit, correct one here or the client can't tell where
            # the body ends.
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
        finally:
            conn.close()

    def do_GET(self):
        self._proxy()

    def do_POST(self):
        self._proxy()

    def do_PUT(self):
        self._proxy()

    def do_DELETE(self):
        self._proxy()

    def do_HEAD(self):
        self._proxy()

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), ProxyHandler)
    print(f"beszel-proxy listening on 0.0.0.0:{LISTEN_PORT}, forwarding to {UPSTREAM_HOST}:{UPSTREAM_PORT}")
    server.serve_forever()
