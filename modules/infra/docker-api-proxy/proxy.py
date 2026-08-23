#!/usr/bin/env python3
"""Sits between docker.giomartins.dev (cloudflared) and the real
dockerd, both on gio-server. Exists for exactly one reason: the
kreuzwerker/terraform-provider-docker client sends a (legacy, always
empty in practice) JSON body on POST .../start — a call the Docker
API deprecated at v1.22 and outright rejects on v1.24+. Confirmed live
against provider versions 3.0.2 through 4.5.0: all of them send it,
none work against this host's Docker Engine (29.5.3, API 1.54) as a
result. Reported upstream — see the repo's issue tracker — but with no
fix released, this strips the body on exactly the container lifecycle
calls that trip the daemon's rejection and passes every other request
through untouched.

Listens on 127.0.0.1:2375 (where cloudflared's ingress rule for
docker.giomartins.dev points); the real dockerd listens on
127.0.0.1:2376 (see docker.service.d/override.conf on the host).
"""

import http.client
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM_HOST = "127.0.0.1"
UPSTREAM_PORT = 2376
LISTEN_PORT = 2375

# Every Docker API lifecycle call known to carry this legacy body.
STRIP_BODY_PATH = re.compile(r"/containers/[^/]+/(start|stop|restart|kill|pause|unpause)(\?.*)?$")

HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"}


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _proxy(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        if self.command == "POST" and STRIP_BODY_PATH.search(self.path):
            body = b""

        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP and k.lower() != "content-length"}
        if body:
            headers["Content-Length"] = str(len(body))

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
            # the body ends ("unexpected EOF" on the client side,
            # confirmed live).
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
        # Docker API traffic is noisy and not secret-bearing (auth
        # happens upstream, at Access) — default logging is fine, just
        # routed through print() so it shows in `docker logs`.
        print("%s - %s" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", LISTEN_PORT), ProxyHandler)
    print(f"docker-api-proxy listening on 127.0.0.1:{LISTEN_PORT}, forwarding to {UPSTREAM_HOST}:{UPSTREAM_PORT}")
    server.serve_forever()
