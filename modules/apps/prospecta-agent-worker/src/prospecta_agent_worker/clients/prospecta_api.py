"""Cliente HTTP da prospecta-api (o BFF/ACL do contexto).

Só HTTP, com ``X-API-Key``. Nenhum driver de banco, nenhum broker próprio
(§1.1) -- a persistência é do par de domínio. Aqui o worker **lê** o que precisa
para os guardrails e **persiste** o que o agente produz:

- ``GET /opt-outs/{lead_id}`` -- consultado **antes** de todo envio (R7);
- ``GET /leads/by-phone/{number}`` -- resolve qual lead/tenant originou uma
  resposta do WhatsApp (o payload do Evolution só traz o JID);
- ``POST /leads`` -- upsert idempotente (``domain+company_name``) do lead
  descoberto; devolve o ``id`` usado daí em diante;
- ``POST /leads/{id}/qualify`` -- persiste o fit;
- ``POST /agent/runs/{id}`` -- atualiza o estado do run que o DOMÍNIO criou;
- ``POST /messages`` -- persiste a mensagem redigida/enviada.

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

    def _h(self, tenant_id: str | None = None) -> dict:
        """Headers da chamada. O worker é principal de SISTEMA (X-API-Key) e
        processa eventos de VÁRIOS tenants: o X-Tenant-Id explícito diz a qual
        tenant a campanha/lead pertence (a sessão de usuário nunca o honra — por
        isso só o worker o manda). Sem tenant, vale o workspace do operador."""
        if not tenant_id:
            return self._headers
        return {**self._headers, "X-Tenant-Id": tenant_id}

    async def is_opted_out(self, lead_id: str, *, tenant_id: str | None = None) -> bool:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base}/opt-outs/{lead_id}", headers=self._h(tenant_id))
        if resp.status_code == 404:
            return False
        if resp.status_code >= 300:
            raise RuntimeError(f"prospecta-api opt-out {resp.status_code}: {resp.text[:200]}")
        return bool(_safe_json(resp).get("opted_out", False))

    async def lead_for_phone(self, number: str, *, tenant_id: str | None = None) -> LeadRef | None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base}/leads/by-phone/{number}", headers=self._h(tenant_id))
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
    async def get_campaign(self, campaign_id: str, *, tenant_id: str | None = None) -> dict | None:
        return await self._get(f"/campaigns/{campaign_id}", tenant_id)

    async def get_lead(self, lead_id: str, *, tenant_id: str | None = None) -> dict | None:
        return await self._get(f"/leads/{lead_id}", tenant_id)

    async def get_message(self, message_id: str, *, tenant_id: str | None = None) -> dict | None:
        return await self._get(f"/messages/{message_id}", tenant_id)

    # -------------------------------------------------------------- escritas
    async def upsert_lead(
        self,
        *,
        campaign_id: str,
        company_name: str,
        domain: str | None = None,
        segment: str | None = None,
        channel: str | None = None,
        source_url: str | None = None,
        enriched: dict | None = None,
        tenant_id: str | None = None,
    ) -> str:
        """Persiste o lead descoberto (`POST /leads`, upsert idempotente) → ``id``.

        A chave natural ``domain+company_name`` é do domínio; a reentrega do
        mesmo negócio reusa o id. Devolve ``""`` se a API não devolver um id.
        """
        body: dict = {"campaign_id": campaign_id, "company_name": company_name}
        for key, value in (
            ("domain", domain),
            ("segment", segment),
            ("channel", channel),
            ("source_url", source_url),
        ):
            if value is not None:
                body[key] = value
        if enriched is not None:
            body["enriched"] = enriched
        parsed = await self._post("/leads", body, tenant_id)
        return str(parsed.get("id", ""))

    async def qualify_lead(self, lead_id: str, fit: int, *, tenant_id: str | None = None) -> None:
        """Persiste o fit do lead (`POST /leads/{id}/qualify`) → 202."""
        if not lead_id:
            return
        await self._post(f"/leads/{lead_id}/qualify", {"fit": max(0, min(100, int(fit)))}, tenant_id)

    async def create_message(
        self, *, lead_id: str, channel: str, content: str, tenant_id: str | None = None
    ) -> str:
        """Persiste a mensagem (`POST /messages`) → ``id``.

        Alinha o comando de domínio ao estado real da conversa; o domínio a
        guarda como ``drafted`` sob ``policy.approval=human``.
        """
        parsed = await self._post(
            "/messages", {"lead_id": lead_id, "channel": channel, "content": content}, tenant_id
        )
        return str(parsed.get("id", ""))

    async def _post(self, path: str, body: dict, tenant_id: str | None = None) -> dict:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base}{path}", headers=self._h(tenant_id), json=body)
        if resp.status_code >= 300:
            raise RuntimeError(f"prospecta-api {path} {resp.status_code}: {resp.text[:200]}")
        return _safe_json(resp)

    async def _get(self, path: str, tenant_id: str | None = None) -> dict | None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base}{path}", headers=self._h(tenant_id))
        if resp.status_code == 404:
            return None
        if resp.status_code >= 300:
            raise RuntimeError(f"prospecta-api {path} {resp.status_code}: {resp.text[:200]}")
        return _safe_json(resp)

    async def update_run(
        self, run_id: str, *, state: str, metrics: dict | None = None, tenant_id: str | None = None
    ) -> None:
        """Persiste a transição de estado do run (`POST /agent/runs/{id}`).

        O run JÁ é criado pelo domínio (o ``ProspectRequested`` carrega
        ``run_id``); este worker só o ATUALIZA -- nunca abre um segundo run.
        """
        if not run_id:
            return
        body = {"state": state}
        if metrics is not None:
            body["metrics"] = metrics
        await self._post(f"/agent/runs/{run_id}", body, tenant_id)


def _safe_json(resp: httpx.Response) -> dict:
    try:
        parsed = resp.json()
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
