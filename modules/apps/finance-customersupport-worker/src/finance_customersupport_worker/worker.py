"""O núcleo do worker: traduz um evento do Evolution em comando + resposta.

Separado do consumidor AMQP de propósito: o consumidor só entrega eventos; a
lógica — NLU, chamada à finance-api, render e envio — vive aqui, testável sem
broker. É idempotente por ``data.key.id`` (§5.3, §12.5): a mesma mensagem
entregue duas vezes (at-least-once) tem efeito único.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from finance_customersupport_worker.clients.finance_api import (
    FinanceApiClient,
    FinanceQueued,
    FinanceRejected,
)
from finance_customersupport_worker.gateway.evolution import EvolutionClient
from finance_customersupport_worker.nlu.parser import parse
from finance_customersupport_worker.rendering import chart
from finance_customersupport_worker.rendering.events import (
    BUDGET_THRESHOLD_REACHED,
    TRANSACTION_CATEGORIZED,
    TRANSACTION_REGISTERED,
    TRANSFER_COMPLETED,
    phone_to_jid,
    render_event,
)
from finance_customersupport_worker.rendering.text import (
    render,
    render_breakdown,
    render_chart_caption,
    render_dashboard,
)

log = logging.getLogger("finance-customersupport-worker")

EVENT_MESSAGES_UPSERT = "messages.upsert"

# Eventos que são a CONFIRMAÇÃO de um comando que este worker pode ter
# originado: se o command_id bate, o usuário já recebeu a resposta na hora e a
# proativa seria duplicada. Alerta de orçamento NÃO entra aqui (informação nova).
_CONFIRMATION_EVENTS = frozenset({TRANSACTION_REGISTERED, TRANSFER_COMPLETED, TRANSACTION_CATEGORIZED})


def extract_text(data: dict) -> str | None:
    """O texto da mensagem, nas duas formas que o Evolution usa.

    ``conversation`` (texto simples) e ``extendedTextMessage.text`` (texto com
    contexto — citação, link). Áudio/imagem/etc. devolvem ``None``.
    """
    message = data.get("message") or {}
    if isinstance(message.get("conversation"), str):
        return message["conversation"]
    extended = message.get("extendedTextMessage")
    if isinstance(extended, dict) and isinstance(extended.get("text"), str):
        return extended["text"]
    return None


class Worker:
    def __init__(self, *, finance: FinanceApiClient, evolution: EvolutionClient) -> None:
        self._finance = finance
        self._evolution = evolution
        # Ids de mensagem já processados: a entrega é at-least-once. Sem estado
        # durável de propósito -- o worker não tem banco (§1.1); reiniciar perde
        # o conjunto, o que é aceitável (no pior caso, um comando repetido, que
        # a ACL/domain rejeitam por idempotência).
        self._seen: set[str] = set()
        # Idempotência do atendimento proativo: a mesma transação aplicada
        # (mesmo command_id) não vira dois avisos.
        self._seen_events: set[str] = set()
        # Comandos que ESTE worker originou. Quando o evento do mesmo comando
        # chega pelo ``domain.events``, o worker já respondeu o desfecho na
        # hora — confirmar de novo seria a mensagem duplicada ("R$ 70" e
        # "R$ -70"). Guardamos só a CONFIRMAÇÃO de transação/transferência; um
        # alerta de orçamento é informação nova e sempre passa.
        self._self_commands: set[str] = set()

    async def handle(self, event: dict) -> None:
        """Processa um evento do Evolution. Eventos irrelevantes são no-op."""
        if event.get("event") != EVENT_MESSAGES_UPSERT:
            return
        data = event.get("data") or {}
        key = data.get("key") or {}
        if key.get("fromMe"):
            return  # eco da própria resposta: nunca vira comando
        remote_jid = key.get("remoteJid")
        if not isinstance(remote_jid, str) or not remote_jid:
            return
        if remote_jid.endswith("@g.us"):
            return  # grupo não é um usuário

        message_id = key.get("id")
        if isinstance(message_id, str):
            if message_id in self._seen:
                return
            self._seen.add(message_id)

        text = extract_text(data)
        if text is None or not text.strip():
            return  # áudio/imagem/vazio: não suportado ainda, sem erro

        phone = remote_jid.split("@", 1)[0]
        occurred_at = datetime.now(UTC).isoformat()
        intent = parse(text, phone=phone, occurred_at=occurred_at)

        if not intent.understood:
            await self._reply(remote_jid, render(intent, "written"))
            return

        # Leitura (§4.2) vs escrita (§4.1): ações `finance.query.*` viajam por
        # `POST /queries` e produzem um card/PNG; o resto é escrita.
        if intent.is_read:
            await self._handle_read(remote_jid, intent)
            return

        outcome, entity_id, error = "failed", "", ""
        try:
            body = await self._finance.submit(intent.action, intent.payload)
            outcome = body.get("status", "written")
            entity_id = body.get("entity_id", "")
            # Lembra o comando que originamos: o evento de confirmação dele
            # (mesmo command_id) não deve virar uma segunda mensagem.
            command_id = body.get("command_id")
            if isinstance(command_id, str) and command_id:
                self._self_commands.add(command_id)
        except FinanceRejected as exc:
            outcome, error = "failed", str(exc)
        except FinanceQueued as exc:
            # Timeout ≠ falha: a resposta diz isso ao usuário.
            outcome, error = "queued", str(exc)
        except Exception as exc:  # noqa: BLE001 -- fala com o usuário, não derruba o loop
            outcome, error = "failed", "serviço indisponível"
            log.error("finance-api falhou: %s", exc)

        await self._reply(remote_jid, render(intent, outcome, entity_id=entity_id, error=error))

    async def _handle_read(self, remote_jid: str, intent) -> None:
        """Relaya a leitura e responde com o card/PNG (§4.2, §5.2)."""
        try:
            body = await self._finance.query(intent.action, intent.payload)
        except FinanceRejected as exc:
            await self._reply(remote_jid, f"⚠️ Não entendi essa consulta: {exc}")
            return
        except Exception as exc:  # noqa: BLE001 -- leitura indisponível não derruba o loop
            log.error("finance-api (leitura) falhou: %s", exc)
            await self._reply(remote_jid, "⚠️ Não consegui buscar seus dados agora.")
            return

        if intent.kind == "grafico":
            png = chart.render_cash_flow_png(body)
            await self._send_media(remote_jid, png, caption=render_chart_caption(body))
            return
        if intent.kind == "extrato":
            await self._reply(remote_jid, render_breakdown(body))
            return
        await self._reply(remote_jid, render_dashboard(body))

    async def _send_media(self, remote_jid: str, png: bytes, *, caption: str) -> None:
        try:
            await self._evolution.send_media(remote_jid, png, caption=caption)
        except Exception as exc:  # noqa: BLE001 -- falha de envio não derruba o consumo
            log.error("envio de mídia pelo Evolution falhou para %s: %s", remote_jid, exc)

    async def handle_domain_event(self, event: dict) -> None:
        """Atende um evento de domínio do tópico ``domain.events`` (proativo).

        O domain-worker publica a transação concluída/aplicada; este worker é o
        encarregado de avisar o cliente. O envelope é
        ``{event_name, occurred_at, payload}`` (ver amqp.event_bus), e o
        ``payload.user_id`` é o telefone — o mesmo que vira JID de volta.

        Idempotente por ``event_id``/``command_id`` (at-least-once, §12.5): o
        mesmo evento reentregue é no-op. Um evento que este worker não atende
        (outra família) devolve ``None`` no render e é ignorado.
        """
        event_name = event.get("event_name")
        payload = event.get("payload") or {}
        if not isinstance(event_name, str) or not isinstance(payload, dict):
            return

        text = render_event(event_name, payload)
        if text is None:
            return  # evento de outra família: não é atendimento deste worker

        command_id = event.get("command_id")
        # Sem eco: se ESTE worker originou o comando e o evento é a
        # CONFIRMAÇÃO dele (transação/transferência/categoria), o usuário já
        # recebeu a resposta na hora — repetir seria a mensagem duplicada
        # ("R$ 70" e "R$ -70"). Um alerta de orçamento NÃO é confirmação: é
        # informação nova, e passa mesmo carregando o mesmo command_id.
        if (
            event_name in _CONFIRMATION_EVENTS
            and isinstance(command_id, str)
            and command_id in self._self_commands
        ):
            return

        # Idempotência: o envelope carrega event_id (estável por entrega), com
        # command_id como reserva. O mesmo evento reentregue é no-op (§12.5).
        key = str(event.get("event_id") or command_id or f"{event_name}:{event.get('occurred_at')}")
        if key in self._seen_events:
            return
        self._seen_events.add(key)

        user_id = payload.get("user_id")
        if not isinstance(user_id, str) or not user_id:
            log.warning("evento %s sem user_id; não há para quem avisar", event_name)
            return
        await self._reply(phone_to_jid(user_id), text)

    async def _reply(self, remote_jid: str, text: str) -> None:
        try:
            await self._evolution.send_text(remote_jid, text)
        except Exception as exc:  # noqa: BLE001 -- falha de envio não derruba o consumo
            log.error("envio pelo Evolution falhou para %s: %s", remote_jid, exc)
