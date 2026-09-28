"""domain-api de mentira, servido de um container de verdade nos testes.

Por que um container e não um mock em processo: o que o teste de integração
verifica é a TRAVESSIA DE REDE -- o worker monta a URL, manda os headers, o
servidor responde, o worker decodifica. Um `unittest.mock` que troca o
`urllib` não exercita nada disso, e foi exatamente uma mudança de contrato de
payload (o codemod que renomeou os produtores e pulou o consumidor) que passou
batido por testes de mock.

O stub guarda estado em memória do próprio processo do container, e expõe um
endpoint de controle (/__state) para o teste configurar o que está pendente e
ler o que foi gravado. Assim o cenário BDD controla o mundo por HTTP, como um
cliente real faria.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE = {
    # O que a fila devolve em GET /fetch-pending.
    "pendentes": [],
    # O que foi gravado em POST /fetch-run/result (lista de payloads).
    "saved": [],
    # O que foi gravado em POST /admin/ingest.
    "ingest": [],
    # O que foi gravado em POST /sync-status.
    "syncs": [],
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
            if self.path.startswith("/fetch-pending"):
                self._json(200, {"pendentes": STATE["pendentes"], "total": len(STATE["pendentes"])})
            elif self.path.startswith("/sync-pending"):
                self._json(200, {"pendentes": [], "total": 0})
            elif self.path.startswith("/__state"):
                self._json(200, STATE)
            else:
                self._json(200, {})

    def do_POST(self):
        body = self._read()
        with LOCK:
            if self.path == "/__state":
                # Controle do teste: define o que a fila devolve.
                STATE.update(body)
                self._json(200, {"ok": True})
            elif self.path == "/fetch-run/result":
                STATE["saved"].append(body)
                self._json(202, {"status": "accepted"})
            elif self.path == "/admin/ingest":
                STATE["ingest"].append(body)
                self._json(202, {"status": "accepted"})
            elif self.path == "/sync-status":
                STATE["syncs"].append(body)
                self._json(202, {"status": "accepted"})
            else:
                self._json(202, {"status": "accepted"})


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
