"""fin-* de mentira, servidos de um container de verdade nos testes.

Duas bordas de rede do worker são exercitadas aqui, como um cliente real as
veria:

- ``POST /commands`` -- a finance-api (o worker manda o envelope). Guarda o que
  chegou e responde o que o teste roteirizou (written/failed/queued), no mesmo
  shape de `RelayResponse` da finance-api.
- ``POST /message/sendText/<instance>`` -- a Evolution API (o worker manda a
  resposta). Guarda o que chegou e responde 201; se o teste marcar
  ``gateway_fail``, responde 500 para provar que a falha de envio não derruba o
  consumo.

Por que um container e não um mock em processo: o que se verifica é a
TRAVESSIA DE REDE -- o worker monta a URL, manda o header `X-API-Key`/`apikey`,
o servidor responde, o worker decodifica. Um `unittest.mock` que troca o
`httpx` não exercita nada disso.

O stub guarda estado em memória do próprio processo e expõe ``/__state`` para o
teste configurar o roteiro e ler o que foi enviado.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE: dict = {
    # Roteiro da finance-api: "accepted" (202 async, o default §4.1) |
    # "failed" (422) | "queued" (504).
    "finance_outcome": "accepted",
    "entity_id": "tx-1",
    # Projeção devolvida por POST /queries (§4.2), por action.
    "queries": {},
    # Roteiro do gateway: quando True, /message/sendText responde 500.
    "gateway_fail": False,
    # O que chegou (listas de payloads).
    "commands": [],
    "queries_seen": [],
    "sends": [],
    "medias": [],
}
LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silencia o log por requisição
        pass

    def _json(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        with LOCK:
            if self.path.startswith("/__state"):
                self._json(200, STATE)
            else:
                self._json(200, {})

    def do_POST(self):
        body = self._read()
        with LOCK:
            if self.path == "/__state":
                STATE.update(body)
                self._json(200, {"ok": True})
            elif self.path == "/commands":
                STATE["commands"].append(body)
                outcome = STATE["finance_outcome"]
                if outcome == "accepted":
                    # O default assíncrono (§4.1): 202, o worker aplica.
                    self._json(202, {"command_id": "cmd-1", "status": "accepted", "relay": "async"})
                elif outcome == "written":
                    self._json(200, {"command_id": "cmd-1", "status": "written", "entity_id": STATE["entity_id"], "relay": "sync"})
                elif outcome == "failed":
                    self._json(422, {"command_id": "cmd-1", "status": "failed", "error": "unknown action"})
                else:
                    self._json(504, {"command_id": "cmd-1", "status": "queued", "error": "still queued, may still land"})
            elif self.path == "/queries":
                STATE["queries_seen"].append(body)
                projection = STATE["queries"].get(body.get("action"))
                if projection is None:
                    self._json(422, {"error": "unknown read action"})
                else:
                    self._json(200, projection)
            elif self.path.startswith("/message/sendText/"):
                if STATE["gateway_fail"]:
                    self._json(500, {"error": "gateway down"})
                else:
                    STATE["sends"].append({"instance": self.path.rsplit("/", 1)[-1], **body})
                    self._json(201, {"key": {"id": "out-1"}, "status": "PENDING"})
            elif self.path.startswith("/message/sendMedia/"):
                if STATE["gateway_fail"]:
                    self._json(500, {"error": "gateway down"})
                else:
                    STATE["medias"].append({"instance": self.path.rsplit("/", 1)[-1], **body})
                    self._json(201, {"key": {"id": "media-1"}, "status": "PENDING"})
            else:
                self._json(404, {"error": f"no route {self.path}"})


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
