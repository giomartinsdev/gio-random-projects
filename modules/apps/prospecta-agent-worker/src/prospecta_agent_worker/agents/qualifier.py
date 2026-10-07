"""Qualificação: calcula o ``fit`` (0..100) comparando o prospect ao ICP.

O score é pedido ao 9router (R2) como um JSON curto -- o modelo vê a definição
do ICP e o prospect já enriquecido (PII redigida por ``guardrails.scrub_payload``
ANTES da chamada) e devolve ``{"fit": N}``. O ``Qualifier`` normaliza para o
invariante do contrato (int em 0..100) e é o dono do ciclo de vida do lead:

``LeadDiscovered`` (achado) → ``LeadEnriched`` (enriquecido) → ``LeadQualified``
(com fit). Cada um carrega o ``lead_id`` estável.

Dedup é do **orchestrator** (chave natural ``domain+company_name``): o qualifier
assume um lead por chamada.
"""

from __future__ import annotations

import json
import re
from typing import Any

from prospecta_agent_worker.agents import guardrails
from prospecta_agent_worker.bus import EventPublisher
from prospecta_agent_worker.gateway.ninerouter import NineRouterClient

_FIT_RE = re.compile(r'"fit"\s*:\s*(\d+)')


def parse_fit(content: str) -> int | None:
    """Extrai o fit de um completion. ``None`` se não houver um int válido.

    Aceita o JSON estrito (``{"fit": 87}``) e um objeto cercado de prosa, porque
    o modelo às vezes embrulha a resposta -- o que não se aceita é um "chute".
    """
    match = _FIT_RE.search(content or "")
    if match is None:
        return None
    return int(match.group(1))


class Qualifier:
    def __init__(
        self,
        *,
        ninerouter: NineRouterClient,
        events: EventPublisher,
        model: str = "gpt-4o-mini",
    ) -> None:
        self._ninerouter = ninerouter
        self._events = events
        self._model = model

    async def compute_fit(self, *, icp: dict, lead: dict, enriched: dict) -> int:
        """Pede o fit ao 9router e normaliza para 0..100.

        O contexto vai scrubado (telefone/e-mail nunca cru ao provider, R7).
        Um completion sem um int utilizável **não** vira um fit inventado: cai no
        piso 0 e o lead fica visível para revisão (nunca um falso "ótimo lead").
        """
        safe = guardrails.scrub_payload(
            {
                "icp": icp.get("definition", ""),
                "signals": list(icp.get("signals") or []),
                "company_name": lead.get("company_name", ""),
                "domain": lead.get("domain", ""),
                "enriched": {k: v for k, v in enriched.items() if k not in ("email", "decisor", "phone")},
            }
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "Você qualifica leads B2B. Dado o ICP e o prospect, responda SOMENTE "
                    'com JSON: {"fit": <inteiro 0-100>}. 100 = encaixe perfeito no ICP.'
                ),
            },
            {"role": "user", "content": json.dumps(safe, ensure_ascii=False)},
        ]
        completion = await self._ninerouter.complete(self._model, messages)
        content = completion["choices"][0]["message"]["content"]
        fit = parse_fit(content)
        if fit is None:
            return 0
        return max(0, min(100, fit))

    async def publish_discovered(self, *, lead: dict, tenant_id: str) -> None:
        await self._events.publish(
            "LeadDiscovered",
            {
                "lead_id": lead["lead_id"],
                "tenant_id": tenant_id,
                "campaign_id": lead.get("campaign_id", ""),
                "company_name": lead.get("company_name", ""),
                "domain": lead.get("domain"),
                "segment": lead.get("segment"),
                "channel": lead.get("channel"),
                "fit": None,
                "source_url": lead.get("source_url"),
                "status": "discovered",
            },
        )

    async def publish_enriched(self, *, lead_id: str, tenant_id: str, enriched: dict) -> None:
        await self._events.publish(
            "LeadEnriched",
            {"lead_id": lead_id, "tenant_id": tenant_id, "enriched": dict(enriched)},
        )

    async def publish_qualified(self, *, lead_id: str, tenant_id: str, fit: int) -> None:
        await self._events.publish(
            "LeadQualified",
            {"lead_id": lead_id, "tenant_id": tenant_id, "fit": max(0, min(100, int(fit))), "status": "qualified"},
        )
