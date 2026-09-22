"""As filas interativas: o clique vira trabalho, e o pedido SEMPRE fecha.

O contrato que a tela de resgate depende:

- um pedido na fila é processado (o elenco é buscado);
- a linha é FECHADA depois -- inclusive quando a busca falha. Sem isso o
  pedido voltaria em todo tick e a tela ficaria "buscando" para sempre;
- um clube que falha não impede os outros: cada um tem seu próprio erro.
"""

from __future__ import annotations

from clubs_ingest.queues import drain_fetch_queue, drain_sync_queue


class FakeDomain:
    def __init__(self, pendentes=None, syncs=None):
        self.pendentes = pendentes or []
        self.syncs = syncs or []
        self.saved: list[dict] = []
        self.marked: list[tuple] = []

    def list_pending_fetches(self):
        return self.pendentes

    def save_fetch_run(self, club_id, **kw):
        self.saved.append({"club_id": club_id, **kw})

    def list_pending_syncs(self):
        return self.syncs

    def mark_sync_done(self, email, **kw):
        self.marked.append((email, kw))


class FakeIngest:
    def __init__(self, result=(3, 2), fail_on=None):
        self.result = result
        self.fail_on = fail_on or set()
        self.called: list[str] = []

    def run_fetch(self, club_id):
        self.called.append(club_id)
        if club_id in self.fail_on:
            raise RuntimeError("a fonte bloqueou")
        return self.result


def test_fetch_queue_processes_and_closes_the_row():
    domain = FakeDomain(pendentes=[{"club_id": "141881"}])
    ingest = FakeIngest(result=(18, 10))

    feitos = drain_fetch_queue(domain, ingest)

    assert feitos == 1
    assert ingest.called == ["141881"]
    assert domain.saved and domain.saved[0]["club_id"] == "141881"
    assert domain.saved[0]["concluido"] is True
    assert domain.saved[0]["rodando"] is False
    assert domain.saved[0]["jogadores"] == 18


def test_fetch_failure_still_closes_the_row():
    """O caso que deixaria a tela presa: se a linha não fechasse no erro, o
    pedido voltaria em todo tick e a SPA pollaria "buscando" para sempre."""
    domain = FakeDomain(pendentes=[{"club_id": "ruim"}])
    ingest = FakeIngest(fail_on={"ruim"})

    feitos = drain_fetch_queue(domain, ingest)

    assert feitos == 0
    assert domain.saved, "a linha precisa ser fechada mesmo no erro"
    assert domain.saved[0]["concluido"] is True
    assert domain.saved[0]["rodando"] is False
    assert "a fonte bloqueou" in domain.saved[0]["erro"]


def test_one_bad_club_does_not_stop_the_others():
    domain = FakeDomain(pendentes=[{"club_id": "ruim"}, {"club_id": "bom"}])
    ingest = FakeIngest(fail_on={"ruim"})

    drain_fetch_queue(domain, ingest)

    assert set(ingest.called) == {"ruim", "bom"}, "o bom precisa ser tentado"
    por_clube = {s["club_id"]: s for s in domain.saved}
    assert por_clube["bom"]["concluido"] is True
    assert not por_clube["bom"].get("erro"), "o clube bom fecha sem erro"


def test_empty_fetch_queue_is_a_noop():
    domain = FakeDomain()
    assert drain_fetch_queue(domain, FakeIngest()) == 0
    assert domain.saved == []


def test_a_broken_queue_does_not_crash_the_loop():
    """Se a domain-api estiver fora, a leitura da fila falha -- e o worker
    precisa seguir vivo para o próximo tick."""
    class BrokenDomain(FakeDomain):
        def list_pending_fetches(self):
            raise RuntimeError("domain-api fora")

    assert drain_fetch_queue(BrokenDomain(), FakeIngest()) == 0


# ------------------------------------------------------------------ sync

class FakeSync:
    def __init__(self, fail_on=None):
        self.fail_on = fail_on or set()
        self.called: list[str] = []

    def run(self, email):
        self.called.append(email)
        if email in self.fail_on:
            raise RuntimeError("sync quebrado")
        return {"niveis": {"1": 1, "2": 2, "3": 3}}


def test_sync_queue_runs_and_reports():
    domain = FakeDomain(syncs=[{"usuario_email": "me@test"}])
    assert drain_sync_queue(domain, FakeSync()) == 1


def test_sync_failure_closes_the_request():
    """Um pedido permanentemente quebrado bloquearia os próximos da fila."""
    domain = FakeDomain(syncs=[{"usuario_email": "quebrado@test"}])
    drain_sync_queue(domain, FakeSync(fail_on={"quebrado@test"}))

    assert domain.marked, "o pedido precisa ser fechado"
    assert domain.marked[0][0] == "quebrado@test"
