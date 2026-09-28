"""As filas interativas: o clique vira trabalho, e o pedido SEMPRE fecha.

O contrato que a tela de resgate depende:

- um pedido na fila é processado (o elenco é buscado);
- a linha é FECHADA depois -- inclusive quando a busca falha. Sem isso o
  pedido voltaria em todo tick e a tela ficaria "buscando" para sempre;
- um clube que falha não impede os outros: cada um tem seu próprio error.
"""

from __future__ import annotations

from clubs_ingest.queues import drain_fetch_queue, drain_search_queue, drain_sync_queue


class FakeDomain:
    def __init__(self, pendentes=None, syncs=None):
        self.pendentes = pendentes or []
        self.syncs = syncs or []
        self.saved: list[dict] = []
        self.marked: list[tuple] = []

    def list_pending_fetches(self):
        return self.pendentes

    def save_fetch_run(self, target, target_id, **kw):
        self.saved.append({"target": target, "target_id": target_id, **kw})

    def list_pending_syncs(self):
        return self.syncs

    def mark_sync_done(self, email, **kw):
        self.marked.append((email, kw))


class FakeIngest:
    def __init__(self, result=(3, 2), fail_on=None, fail_type=RuntimeError):
        self.result = result
        self.fail_on = fail_on or set()
        # RuntimeError = falha permanente (fecha a linha); SourceUnavailable =
        # fonte fora (a linha fica aberta para tentar quando voltar).
        self.fail_type = fail_type
        self.called: list[str] = []
        self.called_jogador: list[str] = []

    def run_fetch(self, club_id):
        self.called.append(club_id)
        if club_id in self.fail_on:
            raise self.fail_type("a fonte bloqueou")
        return self.result

    def run_fetch_jogador(self, player_id):
        self.called_jogador.append(player_id)
        if player_id in self.fail_on:
            raise self.fail_type("a fonte bloqueou")
        # (clubes, jogadores, partidas)
        return (4, 30, 40)


def test_fetch_queue_processes_and_closes_the_row():
    domain = FakeDomain(pendentes=[{"target": "clube", "target_id": "141881"}])
    ingest = FakeIngest(result=(18, 10))

    feitos = drain_fetch_queue(domain, ingest)

    assert feitos == 1
    assert ingest.called == ["141881"]
    assert domain.saved and domain.saved[0]["target_id"] == "141881"
    assert domain.saved[0]["concluido"] is True
    assert domain.saved[0]["running"] is False
    assert domain.saved[0]["players"] == 18


def test_jogador_target_updates_his_clubs_not_a_club_fetch():
    """Syncar jogador é atualizar as matches dos clubs dele: a fonte não tem
    endpoint de jogador. O despacho não pode cair no caminho de clube."""
    domain = FakeDomain(pendentes=[{"target": "jogador", "target_id": "p1"}])
    ingest = FakeIngest()

    feitos = drain_fetch_queue(domain, ingest)

    assert feitos == 1
    assert ingest.called_jogador == ["p1"], "o alvo jogador tem o seu próprio caminho"
    assert ingest.called == [], "e não passa pelo fetch de clube"
    assert domain.saved[0]["target"] == "jogador"
    assert domain.saved[0]["clubs"] == 4, "a contagem de clubes volta para a tela"


def test_fetch_failure_still_closes_the_row():
    """O caso que deixaria a tela presa: se a linha não fechasse no erro, o
    pedido voltaria em todo tick e a SPA pollaria "buscando" para sempre."""
    domain = FakeDomain(pendentes=[{"target": "clube", "target_id": "ruim"}])
    ingest = FakeIngest(fail_on={"ruim"})

    feitos = drain_fetch_queue(domain, ingest)

    assert feitos == 0
    assert domain.saved, "a linha precisa ser fechada mesmo no erro"
    assert domain.saved[0]["concluido"] is True
    assert domain.saved[0]["running"] is False
    assert "a fonte bloqueou" in domain.saved[0]["error"]


def test_one_bad_club_does_not_stop_the_others():
    domain = FakeDomain(pendentes=[
        {"target": "clube", "target_id": "ruim"},
        {"target": "clube", "target_id": "bom"},
    ])
    ingest = FakeIngest(fail_on={"ruim"})

    drain_fetch_queue(domain, ingest)

    assert set(ingest.called) == {"ruim", "bom"}, "o bom precisa ser tentado"
    por_alvo = {s["target_id"]: s for s in domain.saved}
    assert por_alvo["bom"]["concluido"] is True
    assert not por_alvo["bom"].get("error"), "o clube bom fecha sem erro"


def test_empty_fetch_queue_is_a_noop():
    domain = FakeDomain()
    assert drain_fetch_queue(domain, FakeIngest()) == 0
    assert domain.saved == []


def test_a_broken_queue_does_not_crash_the_loop():
    """Se a domain-api estiver fora, a leitura da fila falha -- e o worker
    precisa seguir vivo para o próximo tick."""
    class BrokenDomain(FakeDomain):
        def list_pending_fetches(self):
            raise RuntimeError("domain-api away")

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
    domain = FakeDomain(syncs=[{"user_email": "me@test"}])
    assert drain_sync_queue(domain, FakeSync()) == 1


def test_sync_failure_closes_the_request():
    """Um pedido permanentemente quebrado bloquearia os próximos da fila."""
    domain = FakeDomain(syncs=[{"user_email": "quebrado@test"}])
    drain_sync_queue(domain, FakeSync(fail_on={"quebrado@test"}))

    assert domain.marked, "o pedido precisa ser fechado"
    assert domain.marked[0][0] == "quebrado@test"


# ------------------------------------------------------- busca ao vivo

class FakeSourceSearch:
    def __init__(self, results=None, fail=False):
        self.results = results or []
        self.fail = fail
        self.asked: list[str] = []

    def search(self, termo):
        self.asked.append(termo)
        if self.fail:
            raise RuntimeError("a fonte bloqueou")
        return self.results


def _serch_hit(club_id, name):
    return {
        "clubId": club_id, "clubName": name,
        "wins": "5", "losses": "2", "ties": "1", "gamesPlayed": "8",
        "goals": "12", "goalsAgainst": "8", "cleanSheets": "2",
        "points": "16", "currentDivision": "3", "bestDivision": "2",
        "clubInfo": {"clubId": club_id, "name": name, "regionId": "1", "teamId": "9", "customKit": {}},
    }


def test_search_queue_queries_source_and_writes_clubs():
    """O caso que a busca local não cobre: um clube que o hub nunca viu. O
    termo vai na fonte, os clubes achados entram na base, e a linha fecha."""
    from clubs_ingest.queues import drain_search_queue

    achados = []

    class D(FakeDomain):
        def list_pending_searches(self):
            return [{"termo": "vilanova"}]

        def upsert_club(self, club):
            achados.append(club)

        def upsert_totals(self, club_id, totals):
            pass

        def save_search_run(self, termo, **kw):
            self.saved.append({"termo": termo, **kw})

    source = FakeSourceSearch(results=[_serch_hit("141881", "Vilanova FC")])
    d = D()
    feitos = drain_search_queue(d, source)

    assert feitos == 1
    assert source.asked == ["vilanova"]
    assert achados, "o clube achado precisa ser gravado na base"
    assert achados[0]["club_id"] == "141881"
    assert achados[0]["name"] == "Vilanova FC"
    assert d.saved[0]["concluido"] is True
    assert d.saved[0]["found"] == 1


def test_search_does_not_follow_the_clubs_it_finds():
    """A busca só APRESENTA candidatos -- acompanhar é decisão do resgate. Se a
    busca acompanhasse, digitar um nome mudaria a lista de clubes do hub."""
    from clubs_ingest.queues import drain_search_queue

    achados = []

    class D(FakeDomain):
        def list_pending_searches(self):
            return [{"termo": "x"}]

        def upsert_club(self, club):
            achados.append(club)

        def upsert_totals(self, club_id, totals):
            pass

        def save_search_run(self, *a, **kw):
            pass

    drain_search_queue(D(), FakeSourceSearch(results=[_serch_hit("1", "Achado FC")]))
    assert achados[0]["tracked"] is False


def test_search_failure_still_closes_the_row():
    from clubs_ingest.queues import drain_search_queue

    class D(FakeDomain):
        def list_pending_searches(self):
            return [{"termo": "ruim"}]

        def upsert_club(self, club):
            pass

        def upsert_totals(self, club_id, totals):
            pass

        def save_search_run(self, termo, **kw):
            self.saved.append({"termo": termo, **kw})

    d = D()
    drain_search_queue(d, FakeSourceSearch(fail=True))

    assert d.saved, "a linha precisa fechar mesmo no error"
    assert d.saved[0]["concluido"] is True
    assert "a fonte bloqueou" in d.saved[0]["error"]


def test_source_down_keeps_the_row_open_for_when_it_returns():
    """Fonte fora NÃO é o mesmo que "clube ruim".

    "Clube ruim" (id inexistente, payload inválido) é permanente: a linha
    fecha com erro, senão volta em todo tick para sempre. "Fonte fora" (403,
    CDN, rede) é passageira: fechar perderia o pedido, e a pessoa teria que
    clicar de novo. Aqui a linha fica PENDENTE -- o mesmo loop a pega sozinho
    quando a fonte voltar.
    """
    from clubs_ingest.source import SourceUnavailable

    domain = FakeDomain(pendentes=[{"target": "clube", "target_id": "1"}])
    ingest = FakeIngest(fail_on={"1"}, fail_type=SourceUnavailable)

    feitos = drain_fetch_queue(domain, ingest)

    assert feitos == 0
    assert domain.saved == [], "a linha fica aberta: fecha só quando a fonte voltar"


def test_a_permanent_failure_still_closes_the_row():
    """O contraste: erro permanente fecha (para não voltar para sempre)."""
    domain = FakeDomain(pendentes=[{"target": "clube", "target_id": "1"}])
    ingest = FakeIngest(fail_on={"1"})  # RuntimeError genérico = permanente

    drain_fetch_queue(domain, ingest)

    assert domain.saved and domain.saved[0]["concluido"] is True
    assert domain.saved[0]["error"]


def test_source_down_does_not_mark_sync_done():
    """No sync de pessoa, a fonte fora também deixa o pedido pendente -- senão
    a sincronização seria dada por concluída sem ter buscado nada."""
    from clubs_ingest.source import SourceUnavailable

    domain = FakeDomain(syncs=[{"user_email": "me@test"}])

    class Sync:
        def run(self, email):
            raise SourceUnavailable("a fonte não respondeu")

    drain_sync_queue(domain, Sync())
    assert domain.marked == [], "o pedido continua pendente"


def test_source_down_search_does_not_close_the_row():
    """A busca ao vivo segue a mesma regra: a fonte fora deixa o termo
    pendente, para a resposta chegar sozinha quando ela voltar."""
    from clubs_ingest.source import SourceUnavailable

    class D(FakeDomain):
        def list_pending_searches(self):
            return [{"termo": "vilanova"}]

        def save_search_run(self, termo, **kw):
            self.saved.append({"termo": termo, **kw})

    class S:
        def search(self, termo):
            raise SourceUnavailable("a fonte não respondeu")

    d = D()
    drain_search_queue(d, S())
    assert d.saved == [], "o termo fica pendente: fecha só quando a fonte voltar"
