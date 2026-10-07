"""upstreams de mentira (Evolution + 9router + prospecta-api), servidos de um
container de verdade nos testes.

Três bordas de rede do worker são exercitadas aqui, como um cliente real as
veria:

- ``POST /message/sendText/<instance>`` -- a Evolution API (o worker manda a
  abordagem). Guarda o que chegou (inclusive o header ``apikey``) e responde
  201; se o teste marcar ``gateway_fail``, responde 500.
- ``POST /<...>/chat/completions`` -- o 9router (OpenAI-compatible). Guarda o
  que chegou (path, ``Authorization``, model, messages) e responde o roteiro:
  ``fail_times`` devolve 500 nas próximas N chamadas; ``status >= 500`` devolve
  erro permanente (para provar que o retry é limitado).
- ``GET /opt-outs/<lead_id>`` e ``GET /leads/by-phone/<number>`` -- a
  prospecta-api (opt-out consultado antes de todo envio; lookup do lead que
  originou a resposta).

Por que um container e não um mock em processo: o que se verifica é a
TRAVESSIA DE REDE -- o worker monta a URL, manda o header, o servidor responde,
o worker decodifica. Um ``unittest.mock`` sobre o ``httpx`` não exercita nada
disso.

O stub guarda estado em memória do próprio processo e expõe ``/__state`` para o
teste configurar o roteiro e ler o que foi enviado.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


class _SMTPServer(threading.Thread):
    """Um SMTP mínimo, em processo, para o adapter de e-mail de teste.

    Não é um mock: o ``EmailClient`` de teste abre um socket TCP real, fala o
    handshake SMTP (EHLO/MAIL/RCPT/DATA) e o servidor guarda o que chegou em
    ``STATE["emails"]``. Prova a travessia de rede, não um dublê dela.
    """

    def __init__(self, host: str = "0.0.0.0", port: int = 2525) -> None:
        super().__init__(daemon=True)
        self._host = host
        self._port = port

    def run(self) -> None:
        import socket

        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((self._host, self._port))
        srv.listen(5)
        while True:
            conn, _ = srv.accept()
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn) -> None:
        def send(line: str) -> None:
            conn.sendall((line + "\r\n").encode())

        try:
            send("220 stub ESMTP")
            f = conn.makefile("rb")
            data_mode = False
            to: list[str] = []
            body_parts: list[str] = []
            while True:
                raw = f.readline()
                if not raw:
                    break
                line = raw.decode(errors="replace").rstrip("\r\n")
                if data_mode:
                    if line == ".":
                        data_mode = False
                        with LOCK:
                            STATE["emails"].append({"to": list(to), "raw": "\n".join(body_parts)})
                        send("250 OK queued")
                    else:
                        body_parts.append(line)
                    continue
                upper = line.upper()
                if upper.startswith("EHLO") or upper.startswith("HELO"):
                    send("250-stub")
                    send("250 OK")
                elif upper.startswith("MAIL FROM"):
                    to = []
                    body_parts = []
                    send("250 OK")
                elif upper.startswith("RCPT TO"):
                    to.append(line.split(":", 1)[1].strip().strip("<>"))
                    send("250 OK")
                elif upper == "DATA":
                    data_mode = True
                    send("354 End data with <CR><LF>.<CR><LF>")
                elif upper == "QUIT":
                    send("221 Bye")
                    break
                else:
                    send("250 OK")
        finally:
            conn.close()


STATE: dict = {
    # Quando True, /message/sendText responde 500 (prova que falha de envio não
    # derruba o consumo).
    "gateway_fail": False,
    # O que chegou no gateway (listas de payloads, com headers relevantes).
    "sends": [],
    "medias": [],
    # Opt-out: leads que NÃO podem ser abordados.
    "optouts": [],
    # Lookup do lead por número: {"5521981962914": {"tenant_id":..,"lead_id":..,
    # "thread_key":..}}.
    "leads": {},
    # Roteiro do 9router: {"status": 200, "fail_times": 0, "calls": []}.
    # "contents" é o roteiro por chamada (índice = nº da chamada); vazio usa o
    # completion default. Um teste que precisa de plano + fit distintos define
    # ["...", "{\"fit\": 82}"].
    "ninerouter": {"status": 200, "fail_times": 0, "calls": [], "contents": []},
    # Caixa de saída do SMTP real (servidor cru na porta 2525): o que foi entregue.
    "emails": [],
    # --- tools (adapters isolados) ---
    # web.search (Brave por default): roteiro + o que chegou.
    "search": {"status": 200, "results": [], "calls": []},
    # web.scrape: a página pública servida e o robots.txt do domínio.
    "scrape": {
        "html": "<html><head><title>Página</title></head><body>texto</body></html>",
        "robots": "",
        # O site da empresa para o enrich por DOMÍNIO (provider `cnpj`).
        "company_html": "<html><head><title>Empresa</title></head><body>sem dados</body></html>",
        "company_status": 200,
        "calls": [],
    },
    # enrich.company: o que o provedor devolve + o que chegou.
    "enrich": {"status": 200, "company": {}, "calls": []},
    # enrich.company provedor cnpj: a resposta do publica.cnpj.ws por CNPJ.
    "cnpj": {"status": 200, "company": {}, "calls": []},
    # --- prospecta-api: estado do run e leituras (run/campaign/lead/message) ---
    "runs": [],
    "run_updates": [],
    "campaigns": {},
    "lead_details": {},
    "messages": {},
    # Escritas (o caminho real): o que o worker persistiu.
    # `lead_upserts` guarda cada POST /leads; `qualify_calls` cada POST
    # /leads/{id}/qualify; `message_upserts` cada POST /messages.
    "lead_upserts": [],
    "qualify_calls": [],
    "message_upserts": [],
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

    def _text(self, code: int, body: str) -> None:
        raw = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _html(self, code: int, body: str) -> None:
        raw = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    def do_GET(self):
        with LOCK:
            if self.path.startswith("/__state"):
                self._json(200, STATE)
            elif self.path.startswith("/robots.txt"):
                self._text(200, STATE["scrape"]["robots"])
            elif self.path.startswith("/res/v1/web/search"):
                rt = STATE["search"]
                rt["calls"].append({"path": self.path, "headers": dict(self.headers)})
                if rt["status"] >= 400:
                    self._json(rt["status"], {"error": "search down"})
                else:
                    self._json(200, {"web": {"results": list(rt["results"])}})
            elif self.path.startswith("/search"):
                # SearXNG (LOCAL, sem chave): GET /search?q=...&format=json -> {"results":[...]}.
                rt = STATE["search"]
                rt["calls"].append({"path": self.path, "headers": dict(self.headers)})
                if rt["status"] >= 400:
                    self._json(rt["status"], {"error": "search down"})
                else:
                    self._json(
                        200,
                        {"results": [
                            {"title": r.get("title"), "url": r.get("url"), "content": r.get("snippet")}
                            for r in rt["results"]
                        ]},
                    )
            elif self.path.startswith("/v1/companies/find"):
                rt = STATE["enrich"]
                rt["calls"].append({"path": self.path, "headers": dict(self.headers)})
                if rt["status"] >= 400:
                    self._json(rt["status"], {"error": "enrich down"})
                else:
                    self._json(200, dict(rt["company"]))
            elif self.path.startswith("/cnpj/"):
                # publica.cnpj.ws: GET /cnpj/{14 digitos} -> dados da Receita.
                rt = STATE["cnpj"]
                rt["calls"].append({"path": self.path, "headers": dict(self.headers)})
                if rt["status"] >= 400:
                    self._json(rt["status"], {"error": "cnpj down"})
                else:
                    self._json(200, dict(rt["company"]))
            elif self.path.startswith("/company/"):
                # O SITE da empresa (HTML cru), para o enriquecimento por domínio.
                status = STATE["scrape"].get("company_status", 200)
                if status >= 400:
                    self._text(status, "indisponível")
                else:
                    self._html(200, STATE["scrape"]["company_html"])
            elif self.path.startswith("/pages/"):
                self._html(200, STATE["scrape"]["html"])
            elif self.path.startswith("/opt-outs/"):
                lead_id = self.path.rsplit("/", 1)[-1].split("?", 1)[0]
                self._json(200, {"opted_out": lead_id in STATE["optouts"]})
            elif self.path.startswith("/leads/by-phone/"):
                number = self.path.rsplit("/", 1)[-1].split("?", 1)[0]
                ref = STATE["leads"].get(number)
                if ref is None:
                    self._json(404, {"error": "lead not found"})
                else:
                    self._json(200, dict(ref))
            elif self.path.startswith("/campaigns/"):
                cid = self.path.rsplit("/", 1)[-1].split("?", 1)[0]
                ref = STATE["campaigns"].get(cid)
                if ref is None:
                    self._json(404, {"error": "campaign not found"})
                else:
                    self._json(200, dict(ref))
            elif self.path.startswith("/messages/"):
                mid = self.path.rsplit("/", 1)[-1].split("?", 1)[0]
                ref = STATE["messages"].get(mid)
                if ref is None:
                    self._json(404, {"error": "message not found"})
                else:
                    self._json(200, dict(ref))
            elif self.path.startswith("/leads/"):
                lid = self.path.rsplit("/", 1)[-1].split("?", 1)[0]
                ref = STATE["lead_details"].get(lid)
                if ref is None:
                    self._json(404, {"error": "lead not found"})
                else:
                    self._json(200, dict(ref))
            else:
                self._json(200, {})

    def do_POST(self):
        body = self._read()
        with LOCK:
            if self.path == "/__state":
                STATE.update(body)
                self._json(200, {"ok": True})
            elif self.path.startswith("/message/sendText/"):
                if STATE["gateway_fail"]:
                    self._json(500, {"error": "gateway down"})
                else:
                    STATE["sends"].append(
                        {
                            "instance": self.path.rsplit("/", 1)[-1],
                            "number": body.get("number"),
                            "text": body.get("text"),
                            "apikey": self.headers.get("apikey"),
                            "content_type": self.headers.get("Content-Type"),
                        }
                    )
                    self._json(201, {"key": {"id": "out-1"}, "status": "PENDING"})
            elif self.path.startswith("/message/sendMedia/"):
                if STATE["gateway_fail"]:
                    self._json(500, {"error": "gateway down"})
                else:
                    STATE["medias"].append({"instance": self.path.rsplit("/", 1)[-1], **body})
                    self._json(201, {"key": {"id": "media-1"}, "status": "PENDING"})
            elif self.path.rstrip("/").endswith("/chat/completions"):
                rt = STATE["ninerouter"]
                rt["calls"].append(
                    {
                        "path": self.path,
                        "authorization": self.headers.get("Authorization"),
                        "model": body.get("model"),
                        "messages": body.get("messages"),
                        "stream": body.get("stream"),
                    }
                )
                if rt["fail_times"] > 0:
                    rt["fail_times"] -= 1
                    self._json(500, {"error": "upstream 500"})
                elif rt["status"] >= 500:
                    self._json(rt["status"], {"error": "upstream down"})
                else:
                    idx = len(rt["calls"]) - 1
                    content = "texto do modelo"
                    if idx < len(rt.get("contents") or []):
                        content = rt["contents"][idx]
                    self._json(
                        200,
                        {
                            "id": "chatcmpl-1",
                            "object": "chat.completion",
                            "choices": [
                                {
                                    "index": 0,
                                    "message": {"role": "assistant", "content": content},
                                    "finish_reason": "stop",
                                }
                            ],
                            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                        },
                    )
            elif self.path == "/agent/runs":
                run_id = f"run-{len(STATE['runs']) + 1}"
                STATE["runs"].append({**body, "run_id": run_id, "state": "running"})
                self._json(201, {"run_id": run_id, "state": "running"})
            elif self.path.startswith("/agent/runs/"):
                run_id = self.path.rsplit("/", 1)[-1]
                STATE["run_updates"].append({"run_id": run_id, **body})
                self._json(200, {"run_id": run_id, **body})
            elif self.path == "/leads":
                # POST /leads (upsert idempotente por domain+company_name) -> 202 {id}
                company = body.get("company_name", "")
                key = f"{(body.get('domain') or '').strip().lower()}|{company.strip().lower()}"
                existing = next(
                    (u for u in STATE["lead_upserts"] if u["_key"] == key),
                    None,
                )
                if existing is not None:
                    existing.update(body)
                    lead_id = existing["id"]
                else:
                    lead_id = f"lead-{len(STATE['lead_upserts']) + 1}"
                    STATE["lead_upserts"].append({**body, "id": lead_id, "_key": key})
                self._json(202, {"id": lead_id})
            elif self.path.startswith("/leads/") and self.path.endswith("/qualify"):
                lead_id = self.path.split("/")[2]
                STATE["qualify_calls"].append({"lead_id": lead_id, **body})
                self._json(202, {"id": lead_id, "status": "accepted"})
            elif self.path == "/messages":
                # POST /messages -> 202 {id}
                message_id = f"msg-{len(STATE['message_upserts']) + 1}"
                STATE["message_upserts"].append({**body, "id": message_id})
                self._json(202, {"id": message_id})
            else:
                self._json(404, {"error": f"no route {self.path}"})


if __name__ == "__main__":
    _SMTPServer().start()
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()