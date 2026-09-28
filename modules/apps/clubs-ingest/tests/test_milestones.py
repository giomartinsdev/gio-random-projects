"""Marcos: o hub transforma um número redondo num momento datado do feed.

É história que a fonte não tem -- a EA só conhece o total ATUAL, não sabe dizer
"o clube chegou a 100 jogos". Estes testes fixam a regra que torna o marco útil
e não ruído: ele dispara EXATAMENTE no valor do marco, uma vez.
"""

from __future__ import annotations

from clubs_ingest.cycle import MILESTONES, CycleStats, Ingest, IngestConfig, hits_milestone


def test_hits_exactly_at_the_milestone():
    assert hits_milestone(100, 100) is True
    assert hits_milestone(500, 500) is True


def test_does_not_hit_before_or_after():
    """O ponto central: `>=` anunciaria o marco para sempre depois de cruzá-lo.

    A leitura é periódica e o total é cumulativo, então 101, 102, ... nunca
    podem disparar o marco de 100 -- senão o feed ganha o mesmo aviso em todo
    ciclo.
    """
    assert hits_milestone(99, 100) is False
    assert hits_milestone(101, 100) is False
    assert hits_milestone(250, 200) is False


def test_a_skipped_milestone_is_not_announced():
    """Quando a fonte pula (98 -> 102), o marco 100 não é anunciado -- preferir
    perder um marco a repeti-lo para sempre é a escolha de produto."""
    assert hits_milestone(98, 100) is False
    assert hits_milestone(102, 100) is False


class FakeDomain:
    def __init__(self):
        self.announcements = []

    def create_announcement(self, a):
        self.announcements.append(a)


def new_ingest(domain):
    return Ingest(source=None, domain=domain, cfg=IngestConfig())


def test_a_milestone_creates_one_announcement_with_the_facts():
    domain = FakeDomain()
    ing = new_ingest(domain)

    ing._announce_milestones("141881", {"played": 100, "goals": 250}, CycleStats())

    marcos = [a for a in domain.announcements if a["kind"] == "novidade"]
    assert len(marcos) == 1, f"esperava 1 marco, veio {len(marcos)}"
    a = marcos[0]
    assert a["data"]["milestone"] == "matches"
    assert a["data"]["value"] == 100
    assert a["reference_id"].endswith(":141881")
    assert a["icon"] == "marco", "chave semântica, não emoji"


def test_a_non_round_total_creates_nothing():
    domain = FakeDomain()
    new_ingest(domain)._announce_milestones("1", {"played": 87, "goals": 312}, CycleStats())
    assert domain.announcements == []


def test_milestones_are_declared_as_round_numbers():
    """Sanidade da tabela: valores redondos e tipos conhecidos -- um typo
    (`"matchs"`) sumiria em silêncio na comparação de tipo."""
    for kind, value, _label in MILESTONES:
        assert kind in {"matches", "goals"}, kind
        assert value % 100 == 0 and value > 0, value
