"""Steps de source_down.feature.

O "worker" aqui é o `drain_fetch_queue` real. A fonte é simulada por um
`FakeIngest` que, quando está fora, levanta `SourceUnavailable` E marca a saúde
-- exatamente o que o `SourceClient` de verdade faz num 403 (`_get` chama
`health.down`). O `domain` é o `DomainClient` real, falando com o container.

O que o cenário NÃO faz: mockar o DomainClient. A gravação (ou não) do
resultado passa por HTTP de verdade, então o teste pega tanto a regra de fila
quanto o contrato de payload.
"""

from __future__ import annotations

import pytest
from pytest_bdd import scenarios, given, when, then, parsers

from clubs_ingest.queues import drain_fetch_queue
from clubs_ingest.source import SourceUnavailable, health

scenarios("../features/source_down.feature")


class FakeIngest:
    """Simula o Ingest com uma fonte que pode estar fora."""

    def __init__(self):
        self.fora = False
        self.invalido: set[str] = set()
        self.chamadas: list[str] = []

    def run_fetch(self, club_id: str):
        self.chamadas.append(club_id)
        if self.fora:
            health.down(f"club_info {club_id}: 403")
            raise SourceUnavailable(f"club_info {club_id}: 403")
        if club_id in self.invalido:
            raise ValueError(f"payload inválido para {club_id}")
        health.ok()
        return (3, 2)

    def run_fetch_jogador(self, player_id: str):
        self.chamadas.append(player_id)
        if self.fora:
            health.down(f"jogador {player_id}: 403")
            raise SourceUnavailable(f"jogador {player_id}: 403")
        health.ok()
        return (1, 3, 2)


@pytest.fixture
def cenario():
    health.ok()
    return {"ingest": FakeIngest()}


@given(parsers.parse('que a fila tem o clube "{clube}" pendente'))
def fila_tem_clube(stub_state, cenario, clube):
    stub_state["set"](pendentes=[{"target": "clube", "target_id": clube}])


@given("a fonte está fora")
def fonte_fora(cenario):
    cenario["ingest"].fora = True


@when("a fonte volta")
def fonte_volta(cenario):
    cenario["ingest"].fora = False


@given("a fonte responde, mas o clube é inválido")
def clube_invalido(cenario):
    cenario["ingest"].fora = False
    cenario["ingest"].invalido.add("quebrado")


@when("o worker drena a fila de fetch")
def drena(domain_client, cenario):
    drain_fetch_queue(domain_client, cenario["ingest"])


@when("o worker drena a fila de fetch de novo")
def drena_de_novo(domain_client, cenario):
    drain_fetch_queue(domain_client, cenario["ingest"])


@then("nenhum resultado foi gravado para o alvo")
def nenhum_resultado(stub_state):
    salvos = [s for s in stub_state["get"]()["saved"] if s.get("concluido")]
    assert salvos == [], f"a fonte fora não pode fechar a linha: {salvos}"


@then(parsers.parse('um resultado foi gravado para o alvo "{alvo}"'))
def resultado_gravado(stub_state, alvo):
    salvos = [s for s in stub_state["get"]()["saved"] if s.get("target_id") == alvo]
    assert salvos, f"esperava um resultado para {alvo}; nada foi gravado"


@then("a saúde publicada marca a fonte como indisponível")
def saude_indisponivel():
    assert health.available is False, "uma falha da fonte precisa marcar a saúde"
    assert health.error, "o motivo vai junto para a tela poder explicar"
