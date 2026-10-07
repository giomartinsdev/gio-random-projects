"""Redação da abordagem (research R3, task T045).

O composer consome ``LeadQualified`` (o domínio publicou de volta) e redige uma
abordagem personalizada por lead via 9router, aplicando o **tom de voz** da
empresa e um **rodapé de opt-out** obrigatório (LGPD/R7). Publica
``MessageDrafted`` -- que o domínio persiste como ``prospecta_message`` em
``drafted``, aguardando aprovação humana.

O contexto do lead vai ao provider **já scrubado** (telefone/e-mail nunca crus,
R7). O rodapé é adicionado pelo composer, não pedido ao modelo: um opt-out que
depende da obediência do LLM não é um guardrail.
"""

from __future__ import annotations

import logging
from uuid import uuid4

from prospecta_agent_worker.agents import guardrails
from prospecta_agent_worker.bus import EventPublisher
from prospecta_agent_worker.clients.prospecta_api import ProspectaApiClient
from prospecta_agent_worker.gateway.ninerouter import NineRouterClient

log = logging.getLogger("prospecta-agent-worker")

# O rodapé de opt-out é fixo e sempre anexado -- nunca gerado pelo modelo.
OPTOUT_FOOTER = "Para não receber mais mensagens, responda SAIR."


class Composer:
    def __init__(
        self,
        *,
        api: ProspectaApiClient,
        ninerouter: NineRouterClient,
        events: EventPublisher,
        model: str = "gpt-4o-mini",
    ) -> None:
        self._api = api
        self._ninerouter = ninerouter
        self._events = events
        self._model = model
        self._seen: set[str] = set()

    async def handle_lead_qualified(self, event: dict) -> None:
        payload = event.get("payload") or {}
        lead_id = payload.get("lead_id")
        tenant_id = payload.get("tenant_id")
        if not isinstance(lead_id, str) or not lead_id:
            return
        if not isinstance(tenant_id, str) or not tenant_id:
            return

        dedup_key = str(event.get("event_id") or event.get("command_id") or f"draft:{lead_id}")
        if dedup_key in self._seen:
            return
        self._seen.add(dedup_key)

        lead = await self._api.get_lead(lead_id)
        if lead is None:
            log.info("LeadQualified de lead sem projeção conhecida; ignorado")
            return

        channel = lead.get("channel") or "whatsapp"
        content = await self._draft(lead)
        message_id = f"msg-{uuid4()}"
        await self._events.publish(
            "MessageDrafted",
            {
                "message_id": message_id,
                "tenant_id": tenant_id,
                "lead_id": lead_id,
                "channel": channel,
                "content": content,
                "direction": "out",
                "status": "drafted",
            },
        )

    async def _draft(self, lead: dict) -> str:
        tone = lead.get("tone") or "profissional e cordial"
        safe = guardrails.scrub_payload(
            {
                "company_name": lead.get("company_name", ""),
                "segment": lead.get("segment", ""),
                "fit": lead.get("fit"),
            }
        )
        messages = [
            {
                "role": "system",
                "content": (
                    f"Você redige abordagens B2B de prospecção no tom {tone}. "
                    "Seja curto (2-3 frases), específico e sem promessas falsas. "
                    "Não inclua telefone nem e-mail."
                ),
            },
            {"role": "user", "content": str(safe)},
        ]
        completion = await self._ninerouter.complete(self._model, messages)
        body = completion["choices"][0]["message"]["content"].strip()
        return f"{body}\n\n{OPTOUT_FOOTER}"
