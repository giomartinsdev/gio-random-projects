"""Thin wrapper over the vendored source client.

``fc27_api.py`` is a third-party, MIT-licensed client (see ``LICENSE.fc27``
next to it) that knows how to pass the source's CDN check. The CDN refuses a
plain Python transport from a datacenter IP -- it fingerprints the TLS/HTTP2
handshake -- so the client's calls go over a browser-impersonating ``curl_cffi``
session (a local patch; see the file). That is the whole reason this worker is
Python instead of Go.

This module only adapts its DataFrame-returning methods to the plain dicts the
normalizer wants, and centralizes the TTL-relevant calls so the cycle stays
readable.

It also owns the answer to one product question: *"can we talk to the source
right now?"* Every call goes through ``_get``, which records a success or a
failure in the module-level :data:`health`. That flag is what the worker
publishes back so the UI can tell a person "we are having trouble reaching the
data provider -- when it comes back, your data syncs on its own", instead of
showing a fake "0 players" in green.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from .fc27_api import FC27API, FC27APIError  # vendored, see LICENSE.fc27

log = logging.getLogger("clubs-ingest")


class SourceUnavailable(Exception):
    """A fonte (EA/CDN) não respondeu, bloqueou ou devolveu lixo.

    Existe para separar dois casos que antes viravam o mesmo: "a fonte
    respondeu que este clube não tem nada" (sucesso, devolve vazio) e "a fonte
    não respondeu" (falha). O cliente engolia os dois no mesmo `return []`, e
    por isso um sync com a EA fora fechava a fila como sucesso -- "0 jogadores"
    na tela, em verde, parecendo "sem dados".

    Quem chama decide: a fila mantém a linha PENDENTE (para tentar de novo
    quando a fonte voltar), o ciclo conta o clube como falho. Nenhum dos dois
    inventa um vazio que parece resposta.
    """


class SourceHealth:
    """Se a fonte está conversável agora, e por quê não.

    O worker é de longa duração e o CDN às vezes bloqueia por IP durante um
    período. Quem percebe isso primeiro é a chamada que falha -- seja no ciclo,
    seja num clique da tela. Este estado é a única fonte de verdade para o
    aviso na interface: a tela lê, não adivinha pelo vazio do dado.

    A fonte volta sozinha: a próxima chamada bem-sucedida marca ``available``
    de novo, e as linhas de fila que continuaram pendentes são reprocessadas no
    mesmo tick que detectou a volta.
    """

    def __init__(self) -> None:
        self.available = True
        self.error = ""
        self.checked_at = 0.0

    def ok(self) -> None:
        self.available = True
        self.error = ""
        self.checked_at = time.time()

    def down(self, reason: str) -> None:
        self.available = False
        self.error = str(reason)[:300]
        self.checked_at = time.time()


# Uma instância só: o worker inteiro fala com a mesma fonte pelo mesmo cliente,
# então a saúde é do processo, não de uma consulta.
health = SourceHealth()


class SourceClient:
    def __init__(self, platform: str = "common-gen5", timeout: int = 15, timezone: str = "UTC") -> None:
        self.api = FC27API(platform=platform, timeout=timeout, timezone=timezone)

    def _get(self, endpoint: str, params: dict[str, Any]) -> Any:
        """Uma consulta à fonte, com a saúde registrada.

        É o único caminho para a fonte: qualquer falha vira ``SourceUnavailable``
        e marca ``health.down``; qualquer resposta marca ``health.ok``. Sem
        centralizar isto, cada método decidia sozinho engolir o erro -- e o
        padrão era engolir.
        """
        try:
            data = self.api.get_json(endpoint, params)
        except FC27APIError as err:
            log.warning("%s %s: %s", endpoint, params, err)
            health.down(f"{endpoint}: {err}")
            raise SourceUnavailable(f"{endpoint} {params}: {err}") from err
        health.ok()
        return data

    # --- raw json, which is what the normalizer consumes ------------------

    def club_info(self, club_id: str) -> dict[str, Any]:
        """Identidade do clube. FONTE FORA SOBE (`SourceUnavailable`).

        `{}` significa "a fonte respondeu e não conhece este clube" -- uma
        resposta. Fundir os dois fazia um sync com a EA fora parecer sucesso.
        """
        data = self._get("clubs/info", {"clubIds": club_id})
        if isinstance(data, dict):
            return next(iter(data.values()), {}) or {}
        return {}

    def club_overall(self, club_id: str) -> dict[str, Any]:
        """Totais do clube. FONTE FORA SOBE (ver `club_info`)."""
        data = self._get("clubs/overallStats", {"clubIds": club_id})
        # A lista pode vir com um `null` no lugar do objeto (clube que a fonte
        # não conhece): devolver o None faria o `.get` estourar lá em cima.
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return data[0]
        return {}

    def club_members(self, club_id: str) -> list[dict[str, Any]]:
        data = self._get("members/stats", {"clubId": club_id})
        if isinstance(data, dict):
            membros = data.get("members") or []
            # Lista de membros com buraco (`null`) acontece; um item assim não é
            # um membro.
            return [m for m in membros if isinstance(m, dict)]
        return []

    def club_members_career(self, club_id: str) -> list[dict[str, Any]]:
        """Os totais de CARREIRA de cada membro no clube.

        Diferente de ``club_members`` (temporada corrente), este endpoint dá o
        acumulado histórico do jogador naquele clube -- e nunca era chamado.
        Não traz ``playerId``: a única chave é o gamertag, então quem consumir
        precisa casar por nome.
        """
        data = self._get("members/career/stats", {"clubId": club_id})
        if isinstance(data, dict):
            membros = data.get("members") or []
            return [m for m in membros if isinstance(m, dict)]
        return []

    # A fonte capa `maxResultCount` em 10 por consulta (pedir 20 devolve 10, e
    # não há cursor para paginar). O que ela tem é um tipo por consulta, e os
    # conjuntos não se sobrepõem: liga + amistoso + playoff dá ~20 partidas
    # distintas do mesmo clube. Olhar só a liga -- como era antes -- é por que
    # o clube parecia ter 10 e a série de temporada parava aí.
    MATCH_TYPES = ("leagueMatch", "friendlyMatch", "playoffMatch")

    def club_matches(
        self,
        club_id: str,
        count: int = 10,
        match_types: tuple[str, ...] = MATCH_TYPES,
    ) -> list[dict[str, Any]]:
        """As últimas partidas do clube, de todos os tipos pedidos, sem duplicata.

        `count` é o teto POR TIPO, não o total: é o que a fonte aceita por
        consulta. O total é até `len(match_types) * count`.

        `match_types` existe porque nem todo chamador quer o histórico: a
        descoberta de rivais (``sync``) só precisa de QUEM o clube enfrentou, e
        ali cada tipo a mais multiplica o crawl (o nível 3 já limita a 5
        partidas por rival para o crawl não explodir). Quem grava o histórico
        -- o ciclo e o fetch sob demanda -- quer os três.
        """
        out: list[dict[str, Any]] = []
        vistos: set[str] = set()
        falhas: list[str] = []
        for match_type in match_types:
            try:
                data = self._get(
                    "clubs/matches",
                    {"clubIds": club_id, "matchType": match_type, "maxResultCount": count},
                )
            except SourceUnavailable as err:
                # Um tipo bloqueado não pode custar os outros: a fonte bloqueia
                # por IP às vezes, e perder a liga por causa do playoff seria
                # trocar dez partidas por nenhuma. Mas se TODOS falharem, a
                # fonte está fora -- e isso sobe, senão o sync "conclui" com 0.
                falhas.append(f"{match_type}: {err}")
                continue
            if not isinstance(data, list):
                continue
            for m in data:
                # Item nulo na lista não é uma partida; e a mesma partida pode
                # aparecer em dois tipos -- o matchId é a chave.
                if not isinstance(m, dict):
                    continue
                mid = str(m.get("matchId") or "")
                if not mid or mid in vistos:
                    continue
                vistos.add(mid)
                out.append(m)
        # Todos os tipos falharam: a fonte não respondeu, e vazio seria mentira.
        # Um tipo só falhando (outro respondeu) ainda é uma resposta parcial.
        if match_types and len(falhas) == len(match_types):
            raise SourceUnavailable(f"club_matches {club_id}: {'; '.join(falhas)}")
        return out

    def leaderboard(self) -> list[dict[str, Any]]:
        """Os 100 melhores clubes, com rank, divisão, skillRating e identidade.

        É o único endpoint que dá uma lista pronta de clubes reais -- a busca
        exige um nome, e a fonte não tem "liste todos". É daqui que a base se
        semeia no primeiro boot.
        """
        data = self._get("allTimeLeaderboard", {})
        return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []

    def search(self, name: str) -> list[dict[str, Any]]:
        data = self._get("allTimeLeaderboard/search", {"clubName": name})
        return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []

    def search_by_id(self, club_id: str, name: str = "") -> list[dict[str, Any]]:
        """A linha da busca para um clube que conhecemos por id.

        O endpoint de busca da fonte só aceita NOME. Passar o id devolvia
        vazio em silêncio -- o que quebrava toda a descoberta de adversário
        (e a divisão, que só a busca traz). Por isso o nome é obrigatório
        quando quem chama o tem: ele está no ``details.name`` do payload da
        partida, que é exatamente de onde o adversário é descoberto.
        """
        target = str(club_id)
        # Sem nome, uma busca pelo id ainda tenta -- a fonte às vezes casa por
        # nome exato, e um clube cujo nome É o id não é impossível.
        for termo in filter(None, [name, target]):
            for row in self.search(termo):
                if str(row.get("clubId")) == target:
                    return [row]
        return []


def from_env() -> SourceClient:
    return SourceClient(
        platform=os.environ.get("CLUBS_INGEST_PLATFORM", "common-gen5"),
        timeout=int(os.environ.get("CLUBS_INGEST_TIMEOUT", "15")),
    )
