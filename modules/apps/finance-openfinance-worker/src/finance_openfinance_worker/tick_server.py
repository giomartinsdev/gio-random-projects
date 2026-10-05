"""Porta HTTP mínima do conector — o "poke" que o webhook da Polp aciona.

O conector é um loop sem host (§8 da spec), mas o webhook (§2.6) precisa de
aonde bater: um servidor HTTP mínimo que só conhece ``GET /healthz`` e
``POST /tick``. O ``/tick`` recebe o ``/openfinance/webhooks/polp`` da ACL e
dispara ``Syncer.run_once()`` **na hora** — a compra do usuário entra em
segundos, não no próximo poll.

Modelo de segurança (§2.6): a doc do Polp não descreve assinatura HMAC, então
o webhook é *dica de frescor*, nunca dado confiável. A validação aqui é o
segredo no caminho (``OF_TICK_SECRET``): quem não sabe o segredo recebe 404
(não 403 — não vaza que a porta existe). O handler NUNCA usa os bytes do
corpo; o dado real vem sempre da releitura da API do Polp. E o tick é
serializado (um por vez, lock) — dois webhooks no mesmo segundo não fazem
dois syncs em paralelo contra o provedor.
"""

from __future__ import annotations

import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger("finance-openfinance-worker.tick")

_COUNTS: dict[str, int] = {}
_LOCK = threading.Lock()
_SYNC = None  # callable devolvido pelo main


def make_handler(secret: str, sync_fn) -> type:
    class Handler(BaseHTTPRequestHandler):
        def _reply(self, status: int, body: str = "") -> None:
            data = body.encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802 - nome da API base
            if self.path == "/healthz":
                self._reply(200, '{"status":"ok"}')
            else:
                self._reply(404, '{"error":"not found"}')

        def do_POST(self) -> None:  # noqa: N802 - nome da API base
            global _COUNTS
            expected = f"/tick/{secret}"
            if secret != "" and self.path == expected:
                # serializa syncs: webhook duplicado não faz duas passadas
                got = _LOCK.acquire(timeout=0)
                if not got:
                    self._reply(200, '{"status":"already-running"}')
                    return
                try:
                    counts = sync_fn()
                    self._reply(200, '{"status":"synced","counts":' + str(counts).replace("'", '"') + "}")
                except Exception as exc:  # noqa: BLE001 - resposta 5xx não derruba o conector
                    log.error("sync do tick falhou: %s", exc)
                    self._reply(500, '{"error":"sync failed"}')
                finally:
                    _LOCK.release()
                return
            # path errado/segredo errado: 404 — a porta não informa existência
            self._reply(404, '{"error":"not found"}')

        def log_message(self, *args) -> None:  # silencioso: o log real fica no sync
            return

    return Handler


def start_tick_server(listen: str, secret: str, sync_fn) -> ThreadingHTTPServer | None:
    """Sobe a porta do tick. Sem segredo configurado, fica OFF (poll apenas)."""
    if not secret:
        log.warning("OF_TICK_SECRET ausente: porta de webhook desligada (só poll)")
        return None
    try:
        host, port = listen.split(":")[0] or "0.0.0.0", int(listen.split(":")[1])
    except (IndexError, ValueError):
        log.error("OF_LISTEN_ADDR inválida: %r (forma esperada host:port)", listen)
        return None
    server = ThreadingHTTPServer((host, port), make_handler(secret, sync_fn))
    thread = threading.Thread(target=server.serve_forever, name="tick-server", daemon=True)
    thread.start()
    log.info("porta de webhook em %s (tick protegido por segredo no caminho)", listen)
    return server