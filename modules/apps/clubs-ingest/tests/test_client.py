"""O que o worker publica de volta: a saúde da fonte precisa viajar.

A tela lê `source_available` para dizer "estamos com problemas para falar com a
fornecedora dos dados" em vez de mostrar o vazio como resposta. Se o campo não
sair daqui, o caminho inteiro fica mudo -- e o sintoma seria exatamente o que
motivou a mudança: "0 jogadores" verde parecendo "sem dados".
"""

from __future__ import annotations

from clubs_ingest.client import DomainClient


def test_save_ingest_estado_carries_source_health():
    posted = {}

    client = DomainClient.__new__(DomainClient)
    client.post = lambda path, payload: posted.update({"path": path, "payload": payload})

    client.save_ingest_estado(
        cycles=3, clubs_ok=20, clubs_failed=20, new_matches=0,
        snapshots=0, bootstrapped=True, last_error="",
        source_available=False, source_error="clubs/info: 403",
    )

    assert posted["path"] == "/admin/ingest"
    assert posted["payload"]["source_available"] is False
    assert "403" in posted["payload"]["source_error"]


def test_source_health_defaults_to_available():
    """Sem argumento, a fonte vem como disponível: o estado inicial não pode
    acusar uma falha que não aconteceu."""
    posted = {}

    client = DomainClient.__new__(DomainClient)
    client.post = lambda path, payload: posted.update({"payload": payload})

    client.save_ingest_estado(
        cycles=1, clubs_ok=0, clubs_failed=0, new_matches=0,
        snapshots=0, bootstrapped=False,
    )

    assert posted["payload"]["source_available"] is True
    assert posted["payload"]["source_error"] == ""
