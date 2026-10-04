"""Dedup do atendimento: o worker não confirma duas vezes o mesmo comando.

Bug real: quando o usuário manda "gastei 70 de uber", o worker (1) responde na
hora o desfecho do comando e (2) — agora que também lê ``domain.events`` —
responde de novo quando o evento da MESMA transação chega. Resultado: duas
mensagens ("R$ 70,00" e "R$ -70,00"). A correção: o worker lembra o
``command_id`` que ele mesmo originou e o consumidor de eventos pula a
confirmação daquele comando — mas alertas de orçamento (evento diferente)
continuam passando.

Testes com clientes falsos, sem broker nem container: o que se prova é a
lógica de decisão, pura.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from finance_customersupport_worker.worker import Worker


class FakeFinance:
    def __init__(self, *, status: str = "accepted", command_id: str = "cmd-1") -> None:
        self._status = status
        self._command_id = command_id
        self.submitted: list[tuple[str, dict]] = []

    async def submit(self, action: str, payload: dict) -> dict:
        self.submitted.append((action, payload))
        return {"command_id": self._command_id, "status": self._status}

    async def query(self, action: str, params: dict) -> dict:
        return {}


class FakeEvolution:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []
        self.media: list[tuple[str, str]] = []

    async def send_text(self, remote_jid: str, text: str) -> dict:
        self.sent.append((remote_jid, text))
        return {}

    async def send_media(self, remote_jid: str, png: bytes, *, caption: str = "", filename: str = "x.png") -> dict:
        self.media.append((remote_jid, caption))
        return {}


def _worker(finance=None, evolution=None) -> Worker:
    return Worker(finance=finance or FakeFinance(), evolution=evolution or FakeEvolution())


def _upsert(text: str, phone: str = "5521981962914", event_id: str = "msg-1") -> dict:
    return {
        "event": "messages.upsert",
        "data": {"key": {"remoteJid": f"{phone}@s.whatsapp.net", "fromMe": False, "id": event_id}, "message": {"conversation": text}},
    }


def _event(event_name: str, payload: dict, *, command_id: str, event_id: str | None = None) -> dict:
    return {"event_id": event_id or f"evt-{command_id}", "command_id": command_id, "event_name": event_name, "occurred_at": "2026-10-04T12:00:00Z", "payload": payload}


def test_self_originated_transaction_event_does_not_double_reply():
    evo = FakeEvolution()
    fin = FakeFinance(command_id="cmd-uber")
    worker = _worker(fin, evo)

    # 1) o usuário manda a despesa; o worker responde na hora.
    asyncio.run(worker.handle(_upsert("Gastei 70 de uber")))
    assert len(evo.sent) == 1

    # 2) o evento da MESMA transação chega (command_id igual) — não repete.
    asyncio.run(worker.handle_domain_event(
        _event("finance.transaction.registered", {"user_id": "5521981962914", "transaction_type": "EXPENSE", "amount": "-70.00", "category": "Transporte"}, command_id="cmd-uber")
    ))
    assert len(evo.sent) == 1, "o worker não pode confirmar duas vezes o mesmo comando"


def test_external_transaction_event_still_notifies():
    # Uma transação que NÃO é do Open Finance (ex.: o conector de outra fonte no
    # futuro) continua notificando, porque não foi este worker que a originou.
    evo = FakeEvolution()
    worker = _worker(FakeFinance(), evo)
    asyncio.run(worker.handle_domain_event(
        _event("finance.transaction.registered", {"user_id": "5521981962914", "transaction_type": "EXPENSE", "amount": "-70.00", "category": "Transporte"}, command_id="cmd-other")
    ))
    assert len(evo.sent) == 1
    assert "Despesa" in evo.sent[0][1]


def test_open_finance_backfill_does_not_notify():
    # O backfill inicial (historical=true) pode trazer centenas de transações
    # ao conectar; notificar cada uma metralha o WhatsApp. O dado entra no
    # painel; o aviso, não.
    evo = FakeEvolution()
    worker = _worker(FakeFinance(), evo)
    for i in range(5):
        asyncio.run(worker.handle_domain_event(
            _event(
                "finance.transaction.registered",
                {"user_id": "5521981962914", "transaction_type": "EXPENSE", "amount": "-10.00", "category": "Outros",
                 "source_type": "OPEN_FINANCE_SYNC", "historical": True},
                command_id=f"cmd-of-{i}",
                event_id=f"evt-of-{i}",
            )
        ))
    assert evo.sent == [], "o backfill do Open Finance não pode notificar"


def test_open_finance_daily_transaction_notifies():
    # Já o DIA A DIA (historical=false) do Open Finance notifica normalmente:
    # é o gasto que acabou de acontecer.
    evo = FakeEvolution()
    worker = _worker(FakeFinance(), evo)
    asyncio.run(worker.handle_domain_event(
        _event(
            "finance.transaction.registered",
            {"user_id": "5521981962914", "transaction_type": "EXPENSE", "amount": "-12.50", "category": "Alimentação",
             "source_type": "OPEN_FINANCE_SYNC", "historical": False},
            command_id="cmd-of-daily",
        )
    ))
    assert len(evo.sent) == 1
    assert "Despesa" in evo.sent[0][1]


def test_budget_alert_still_notifies_even_amid_open_finance_import():
    # O silêncio é só da CONFIRMAÇÃO de transação do OF. Um alerta de orçamento
    # (informação nova) continua saindo.
    evo = FakeEvolution()
    worker = _worker(FakeFinance(), evo)
    asyncio.run(worker.handle_domain_event(
        _event("finance.budget.thresholdReached", {"user_id": "5521981962914", "category": "Alimentação", "threshold": 80, "spent_amount": "-80.00", "limit_amount": "100.00"}, command_id="cmd-bud")
    ))
    assert len(evo.sent) == 1
    assert "80%" in evo.sent[0][1]


def test_budget_alert_is_not_suppressed_by_a_self_originated_command():
    evo = FakeEvolution()
    worker = _worker(FakeFinance(command_id="cmd-budget"), evo)
    # o usuário define o orçamento; o worker responde na hora.
    asyncio.run(worker.handle(_upsert("orçamento de 100 pra alimentação")))
    assert len(evo.sent) == 1
    # O alerta de régua carrega o MESMO command_id do setCategory (a avaliação
    # roda dentro daquele comando). Mesmo assim DEVE sair: alerta não é
    # confirmação, é informação nova — suprimí-lo esconderia o aviso de 80%.
    asyncio.run(worker.handle_domain_event(
        _event("finance.budget.thresholdReached", {"user_id": "5521981962914", "category": "Alimentação", "threshold": 80, "spent_amount": "-80.00", "limit_amount": "100.00"}, command_id="cmd-budget")
    ))
    assert len(evo.sent) == 2
    assert "80%" in evo.sent[-1][1]
