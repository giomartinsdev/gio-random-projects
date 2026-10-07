"""O núcleo do worker: parse do Evolution, guardrails e envio pela Evolution.

Separado do consumidor AMQP de propósito: o consumidor só entrega eventos; a
lógica -- parse v2.3.7, resolução do lead, guardrails (opt-out/aprovação), PII
scrubbing e envio -- vive aqui, testável sem broker.

O worker é **consumidor e produtor**: traduz o que consome em eventos de
domínio próprios (`ReplyReceived`, `MessageBlocked`), publicados no exchange
fanout `domain.events` (`bus.EventPublisher`). Os agentes de busca/redação
(orchestrator/composer/qualifier) entram nas user stories seguintes; esta é a
base de plumbing + guardrails.

O caminho de ENTRADA (`handle`) é assíncrono porque o consumidor o aguarda. O
caminho de SAÍDA (`send_message`) é síncrono para o chamador de produção/teste,
e roda o pipeline async via ``_run`` -- que é seguro dentro e fora de um loop.
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from prospecta_agent_worker.agents import guardrails
from prospecta_agent_worker.agents.composer import Composer
from prospecta_agent_worker.agents.orchestrator import Orchestrator
from prospecta_agent_worker.agents.tools import EnrichCompany, WebScrape, WebSearch
from prospecta_agent_worker.bus import EventPublisher
from prospecta_agent_worker.clients.prospecta_api import ProspectaApiClient
from prospecta_agent_worker.gateway.email import EmailClient
from prospecta_agent_worker.gateway.evolution import EvolutionClient, phone_to_jid
from prospecta_agent_worker.gateway.ninerouter import NineRouterClient

log = logging.getLogger("prospecta-agent-worker")

DOMAIN_EVENTS = frozenset({"ProspectRequested", "LeadQualified", "MessageApproved"})


def _run(coro):
    """Roda ``coro`` de forma segura dentro ou fora de um loop em execução."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def extract_text(data: dict) -> str | None:
    """O texto da mensagem, nas duas formas que o Evolution usa (v2.3.7).

    ``conversation`` (texto simples) e ``extendedTextMessage.text`` (texto com
    contexto -- citação, link). Áudio/imagem/etc. devolvem ``None``.
    """
    message = data.get("message") or {}
    if isinstance(message.get("conversation"), str):
        return message["conversation"]
    extended = message.get("extendedTextMessage")
    if isinstance(extended, dict) and isinstance(extended.get("text"), str):
        return extended["text"]
    return None


class ProspectaWorker:
    def __init__(
        self,
        *,
        evolution: EvolutionClient,
        ninerouter: NineRouterClient,
        api: ProspectaApiClient,
        events: EventPublisher,
        approval_policy: str = "human",
        search: WebSearch | None = None,
        enrich: EnrichCompany | None = None,
        scrape: WebScrape | None = None,
        email: EmailClient | None = None,
    ) -> None:
        self._evolution = evolution
        self._ninerouter = ninerouter
        self._api = api
        self._events = events
        self._approval_policy = approval_policy
        self._email = email
        # Os agentes (orchestrator/composer) só entram quando as tools existem;
        # um worker sem tools ainda serve o caminho do Evolution.
        self._orchestrator = (
            Orchestrator(
                api=api,
                events=events,
                ninerouter=ninerouter,
                search=search,
                enrich=enrich,
                scrape=scrape,
            )
            if search is not None and enrich is not None
            else None
        )
        self._composer = Composer(api=api, ninerouter=ninerouter, events=events) if search is not None else None
        # Ids de mensagem já processados: a entrega é at-least-once. Sem estado
        # durável de propósito -- o worker não tem banco (§1.1); reiniciar perde
        # o conjunto, e o pior caso é um ReplyReceived duplicado, que o
        # `thread_key` + idempotência do domain-worker absorve.
        self._seen: set[str] = set()
        # Idempotência do envio por evento de domínio (MessageApproved reentrega).
        self._seen_events: set[str] = set()

    # ---------------------------------------------------------------- entrada
    async def handle(self, event: dict) -> None:
        """Processa um evento do Evolution. Eventos irrelevantes são no-op."""
        if event.get("event") != "messages.upsert":
            return
        data = event.get("data") or {}
        key = data.get("key") or {}
        if key.get("fromMe"):
            return  # eco da própria abordagem: nunca vira resposta do lead
        remote_jid = key.get("remoteJid")
        if not isinstance(remote_jid, str) or not remote_jid:
            return
        if remote_jid.endswith("@g.us"):
            return  # grupo não é um número

        message_id = key.get("id")
        if isinstance(message_id, str):
            if message_id in self._seen:
                return
            self._seen.add(message_id)

        text = extract_text(data)
        if text is None or not text.strip():
            return  # áudio/imagem/vazio: não suportado, sem erro

        number = remote_jid.split("@", 1)[0]
        lead = await self._api.lead_for_phone(number)
        if lead is None:
            # Sem lead conhecido não há a quem pertencer; não inventamos tenant.
            log.info("resposta de número sem lead conhecido; ignorada")
            return

        await self._events.publish(
            "ReplyReceived",
            {
                "lead_id": lead.lead_id,
                "tenant_id": lead.tenant_id,
                "thread_key": lead.thread_key,
                "content": text,
                "external_id": str(message_id or ""),
                "direction": "in",
            },
            command_id=str(message_id or ""),
        )

    # ------------------------------------------------------------------ saída
    def send_message(
        self,
        *,
        tenant_id: str,
        lead_id: str,
        remote_jid: str,
        content: str,
        approved: bool = False,
    ) -> dict | None:
        """Envia (ou bloqueia) uma abordagem de WhatsApp, com guardrails.

        Consulta opt-out **antes** de qualquer envio; se a mensagem não está
        aprovada sob ``policy.approval=human``, ou o lead está em opt-out,
        publica ``MessageBlocked`` e **não envia** -- nunca contorna (R7).
        """
        return _run(
            self._send_message(
                tenant_id=tenant_id,
                lead_id=lead_id,
                remote_jid=remote_jid,
                content=content,
                approved=approved,
            )
        )

    async def _send_message(
        self,
        *,
        tenant_id: str,
        lead_id: str,
        remote_jid: str,
        content: str,
        approved: bool,
    ) -> dict | None:
        opted_out = await self._api.is_opted_out(lead_id, tenant_id=tenant_id)
        try:
            guardrails.check_send(
                approved=approved,
                opted_out=opted_out,
                approval_policy=self._approval_policy,
            )
        except guardrails.SendBlocked as blocked:
            await self._events.publish(
                "MessageBlocked",
                {
                    "lead_id": lead_id,
                    "tenant_id": tenant_id,
                    "reason": blocked.code,
                },
            )
            log.warning("envio bloqueado (%s) para lead %s", blocked.code, lead_id)
            return None

        return await self._evolution.send_text(remote_jid, content)

    # ------------------------------------------------- eventos de domínio
    async def handle_domain_event(self, event: dict) -> None:
        """Despacha um evento do fanout ``domain.events`` para o agente certo.

        - ``ProspectRequested`` → o orchestrator abre e conduz o run;
        - ``LeadQualified`` → o composer redige e publica ``MessageDrafted``;
        - ``MessageApproved`` → o envio (Evolution/e-mail), após os guardrails.

        Um evento de outra família é no-op (o fanout entrega tudo a todos).
        """
        event_type = event.get("event_type") or event.get("event_name")
        if event_type not in DOMAIN_EVENTS:
            return
        if event_type == "ProspectRequested":
            if self._orchestrator is None:
                return
            await self._orchestrator.handle_prospect_requested(event)
            return
        if event_type == "LeadQualified":
            if self._composer is None:
                return
            await self._composer.handle_lead_qualified(event)
            return
        await self._handle_message_approved(event)

    async def _handle_message_approved(self, event: dict) -> None:
        payload = event.get("payload") or {}
        message_id = payload.get("message_id")
        tenant_id = payload.get("tenant_id")
        if not isinstance(message_id, str) or not message_id:
            return
        if not isinstance(tenant_id, str) or not tenant_id:
            return

        # Idempotência por evento: a reentrega não envia de novo.
        dedup_key = str(event.get("event_id") or event.get("command_id") or f"send:{message_id}")
        if dedup_key in self._seen_events:
            return
        self._seen_events.add(dedup_key)

        message = await self._api.get_message(message_id, tenant_id=tenant_id)
        if message is None:
            log.info("MessageApproved de mensagem sem projeção conhecida; ignorado")
            return
        lead_id = message.get("lead_id") or ""
        channel = message.get("channel") or "whatsapp"
        content = message.get("content") or ""
        to = message.get("to") or ""

        opted_out = await self._api.is_opted_out(lead_id, tenant_id=tenant_id) if lead_id else False
        try:
            # Já aprovado pelo domínio; a policy humana está satisfeita.
            guardrails.check_send(approved=True, opted_out=opted_out, approval_policy=self._approval_policy)
        except guardrails.SendBlocked as blocked:
            await self._events.publish(
                "MessageBlocked",
                {"lead_id": lead_id, "tenant_id": tenant_id, "reason": blocked.code, "message_id": message_id},
            )
            log.warning("envio bloqueado (%s) para lead %s", blocked.code, lead_id)
            return

        if channel == "email":
            external_id = await self._send_email(to, content)
        else:
            result = await self._evolution.send_text(phone_to_jid(to), content)
            external_id = str((result.get("key") or {}).get("id") or "")

        # Persistência do envio: alinha o comando de domínio ao estado real da
        # mensagem (o `MessageSent` no bus é o mesmo fato para observabilidade).
        if lead_id:
            await self._api.create_message(lead_id=lead_id, channel=channel, content=content, tenant_id=tenant_id)

        await self._events.publish(
            "MessageSent",
            {
                "message_id": message_id,
                "tenant_id": tenant_id,
                "external_id": external_id,
                "sent_at": datetime.now(UTC).isoformat(),
                "status": "sent",
            },
        )

    async def _send_email(self, to: str, content: str) -> str:
        if self._email is None:
            raise RuntimeError("canal email sem EmailClient configurado")
        result = await asyncio.to_thread(
            self._email.send, to, "Uma proposta para sua empresa", content
        )
        return str(result.get("external_id", ""))

    # ------------------------------------------------------------------- IA
    async def draft(self, *, model: str, context: dict, instruction: str) -> str:
        """Redige com o 9router, com PII scrubbing **antes** da chamada (R7).

        O contexto do lead nunca vai cru ao provider: telefone/e-mail são
        redigidos por ``guardrails.scrub_payload`` primeiro.
        """
        safe_context = guardrails.scrub_payload(context)
        messages = [
            {"role": "system", "content": instruction},
            {"role": "user", "content": str(safe_context)},
        ]
        completion = await self._ninerouter.complete(model, messages)
        return completion["choices"][0]["message"]["content"]

    def draft_sync(self, *, model: str, context: dict, instruction: str) -> str:
        return _run(self.draft(model=model, context=context, instruction=instruction))
