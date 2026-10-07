"""Cliente HTTP da prospecta-api (o BFF/ACL do contexto).

Só HTTP, com ``X-API-Key``. Nenhum driver de banco, nenhum broker próprio
(§1.1) -- a persistência é do par de domínio. Aqui o worker só **consulta** o
que precisa para os guardrails:

- ``GET /opt-outs/{lead_id}`` -- consultado **antes** de todo envio (R7);
- ``GET /leads/by-phone/{number}`` -- resolve qual lead/tenant originou uma
  resposta do WhatsApp (o payload do Evolution só traz o JID).

Leitura não tem ambiguidade: 200 é o corpo, qualquer outra coisa é erro. O
``GET`` de opt-out devolve 404 quando o lead não é conhecido -- isso é
``None``, não exceção: quem chama trata "sem lead" como não-enviável.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass(frozen=True, slots=True)
class LeadRef:
    tenant_id: str
    lead_id: str
    thread_key: str


class ProspectaApiClient:
    def __init__(self, base_url: str, api_key: str = "", *, timeout: float = 15.0) -> None:
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._timeout = timeout
        self._headers = {"X-API-Key": self._key, "Content-Type": "application/json"}

    async def is_opted_out(self, lead_id: str) -> bool:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base}/opt-outs/{lead_id}", headers=self._headers)
        if resp.status_code == 404:
            return False
        if resp.status_code >= 300:
            raise RuntimeError(f"prospecta-api opt-out {resp.status_code}: {resp.text[:200]}")
        return bool(_safe_json(resp).get("opted_out", False))

    async def lead_for_phone(self, number: str) -> LeadRef | None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base}/leads/by-phone/{number}", headers=self._headers)
        if resp.status_code == 404:
            return None
        if resp.status_code >= 300:
            raise RuntimeError(f"prospecta-api lead {resp.status_code}: {resp.text[:200]}")
        body = _safe_json(resp)
        tenant_id = body.get("tenant_id")
        lead_id = body.get("lead_id")
        if not tenant_id or not lead_id:
            return None
        return LeadRef(tenant_id=tenant_id, lead_id=lead_id, thread_key=body.get("thread_key", f"wa:{number}"))

    # ------------------------------------------------------------ run / leitura
    async def get_campaign(self, campaign_id: str) -> dict | None:
        return await self._get(f"/campaigns/{campaign_id}")

    async def get_lead(self, lead_id: str) -> dict | None:
        return await self._get(f"/leads/{lead_id}")

    async def get_message(self, message_id: str) -> dict | None:
        return await self._get(f"/messages/{message_id}")

    async def _get(self, path: str) -> dict | None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base}{path}", headers=self._headers)
        if resp.status_code == 404:
            return None
        if resp.status_code >= 300:
            raise RuntimeError(f"prospecta-api {path} {resp.status_code}: {resp.text[:200]}")
        return _safe_json(resp)

    async def start_run(self, *, campaign_id: str, tenant_id: str, agent: str) -> str:
        """Abre um ``prospecta_agent_run`` (POST /agent/runs) e devolve o id."""
        body = {"campaign_id": campaign_id, "tenant_id": tenant_id, "agent": agent, "state": "running"}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base}/agent/runs", headers=self._headers, json=body)
        if resp.status_code >= 300:
            raise RuntimeError(f"prospecta-api run {resp.status_code}: {resp.text[:200]}")
        return str(_safe_json(resp).get("run_id", ""))

    async def update_run(self, run_id: str, *, state: str, metrics: dict | None = None) -> None:
        """Persiste a transição de estado do run -- o estado vive no banco (R1)."""
        if not run_id:
            return
        body = {"state": state}
        if metrics is not None:
            body["metrics"] = metrics
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base}/agent/runs/{run_id}", headers=self._headers, json=body)
        if resp.status_code >= 300:
            raise RuntimeError(f"prospecta-api run update {resp.status_code}: {resp.text[:200]}")


def _safe_json(resp: httpx.Response) -> dict:
    try:
        parsed = resp.json()
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
