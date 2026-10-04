"""Cliente HTTP da finance-api (a ACL do contexto).

Só HTTP, com ``X-API-Key``. Nenhum driver de banco, nenhum broker — o worker é
consumidor, não dono de persistência (§1.1). O contrato de escrita é o da
finance-api: o envelope ``{action, payload}`` em ``POST /commands``, com os três
desfechos documentados (200 written / 422 failed / 504 queued), onde **timeout
não é falha**.
"""

from __future__ import annotations

import httpx


class FinanceRejected(RuntimeError):
    """O comando foi recusado (422): repetir igual falha igual."""


class FinanceQueued(RuntimeError):
    """Timeout (504): o comando segue na fila e pode ser aplicado. Não é recusa."""


class FinanceApiClient:
    def __init__(self, base_url: str, api_key: str, *, timeout: float = 15.0) -> None:
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._timeout = timeout

    async def submit(self, action: str, payload: dict) -> dict:
        """Relaya um comando e devolve o desfecho.

        200 ``written`` é o único confirmado; 422 levanta ``FinanceRejected``
        (o worker avisa o usuário honestamente) e 504 levanta ``FinanceQueued``
        (o worker diz "pode ter sido registrado"). Falha de transporte vira
        ``httpx`` — o chamador decide o que dizer.
        """
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base}/commands",
                headers={"X-API-Key": self._key, "Content-Type": "application/json"},
                json={"action": action, "payload": payload},
            )
        body = _safe_json(resp)
        if resp.status_code == 422:
            raise FinanceRejected(body.get("error", "comando recusado"))
        if resp.status_code == 504:
            raise FinanceQueued(body.get("error", "ainda na fila; pode ser aplicado"))
        if resp.status_code >= 300:
            raise RuntimeError(f"finance-api {resp.status_code}: {body}")
        return body


def _safe_json(resp: httpx.Response) -> dict:
    try:
        parsed = resp.json()
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
