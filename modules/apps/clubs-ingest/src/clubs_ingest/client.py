"""domain-api client for the worker.

Same two write shapes every service in this repo uses:

- ``sync`` -- ``POST /sync``, which holds the request open until
  domain-worker's audit row proves the write landed. Used for the structural
  writes where the worker must not move on believing a club exists when it
  does not.
- ``post`` -- the normal async 202 path, used for the append-only
  high-volume writes (snapshot, announcement), where nobody waits.

Reads use ``get``. No database driver here, and there must never be one.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class DomainError(RuntimeError):
    """A write was rejected (422) — retrying unchanged fails the same way."""


class DomainQueued(RuntimeError):
    """The command was published but not confirmed in time (504). Not a
    rejection: it may still land."""


class DomainClient:
    def __init__(self, base_url: str, api_key: str, timeout: int = 15) -> None:
        self.base = base_url.rstrip("/")
        self.key = api_key
        self.timeout = timeout

    def _request(self, method: str, path: str, payload: Any | None = None) -> tuple[int, bytes]:
        url = self.base + path
        data = None
        headers = {"X-API-Key": self.key, "Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as err:
            return err.code, err.read()

    def get(self, path: str) -> Any:
        status, body = self._request("GET", path)
        if status == 404:
            return None
        if status >= 300:
            raise RuntimeError(f"domain-api GET {path}: {status} {body[:200]!r}")
        if not body:
            return None
        return json.loads(body)

    def sync(self, action: str, payload: dict[str, Any]) -> None:
        """Publish a command and wait for the worker to confirm it landed."""
        status, body = self._request("POST", "/sync", {"action": action, "payload": payload})
        if status == 422:
            raise DomainError(f"{action} rejected: {body[:200]!r}")
        if status == 504:
            raise DomainQueued(f"{action} still queued")
        if status >= 300:
            raise RuntimeError(f"domain-api sync {action}: {status} {body[:200]!r}")

    def post(self, path: str, payload: dict[str, Any]) -> None:
        """Fire a command on the async 202 path."""
        status, body = self._request("POST", path, payload)
        if status >= 300:
            raise RuntimeError(f"domain-api POST {path}: {status} {body[:200]!r}")

    # --- convenience wrappers, named after the action they produce ---------

    def upsert_club(self, club: dict[str, Any]) -> None:
        self.sync("club.upsert", club)

    def upsert_totals(self, club_id: str, totals: dict[str, Any]) -> None:
        self.sync("clubetotais.upsert", totals)

    def upsert_match(self, club_id: str, match: dict[str, Any]) -> None:
        self.sync("partida.upsert", match)

    def append_snapshot(self, club_id: str, snap: dict[str, Any]) -> None:
        # High volume, append-only, nobody waits: the async path.
        self.post(f"/clubs/{urllib.parse.quote(club_id)}/snapshots", snap)

    def create_announcement(self, anuncio: dict[str, Any]) -> None:
        self.post("/announcements", anuncio)

    def upsert_career(self, club_id: str, line: dict[str, Any]) -> None:
        """Grava os totais de carreira de um jogador num clube.

        Alta volumetria e append-only (uma leitura substitui a anterior), então
        vai pelo caminho assíncrono -- ninguém espera por ela.
        """
        self.post(f"/clubs/{urllib.parse.quote(club_id)}/career", line)

    def list_clubs(self, only_followed: bool = True) -> list[dict[str, Any]]:
        path = "/clubs" + ("?acompanhados=1" if only_followed else "")
        data = self.get(path) or {}
        return data.get("clubes") or []

    def list_watch(self, usuario_email: str) -> list[dict[str, Any]]:
        data = self.get(f"/watchlist?usuario={urllib.parse.quote(usuario_email)}") or {}
        return data.get("clubes") or []

    def get_sync_run(self, usuario_email: str) -> dict[str, Any]:
        return self.get(f"/sync-status?usuario={urllib.parse.quote(usuario_email)}") or {}

    def list_pending_syncs(self) -> list[dict[str, Any]]:
        """Quem pediu sincronização e ainda não terminou.

        É a ponte entre o clique no SPA (que grava o pedido) e este worker:
        nenhum dos dois conhece o outro.
        """
        data = self.get("/sync-pending") or {}
        return data.get("pendentes") or []

    def mark_sync_done(self, usuario_email: str, *, nivel: int, total: int,
                       concluidos: int, novos: list[str]) -> None:
        """Fecha o pedido. Sem isto ele voltaria na próxima leitura de pendentes
        e o worker repetiria a descoberta para sempre."""
        self.post("/sync-status", {
            "usuario_email": usuario_email,
            "rodando": False,
            "nivel": nivel,
            "total": total,
            "concluidos": concluidos,
            "atual": "",
            "novos": novos,
            "concluido": True,
        })

    def save_ingest_estado(self, *, rodadas: int, clubes_ok: int, clubes_falhos: int,
                           partidas_novas: int, snapshots: int, bootstrap_feito: bool,
                           ultimo_erro: str = "") -> None:
        """Publica a saúde deste worker.

        Ele é Python e não serve HTTP, então sem isto uma falha em produção
        (inclusive o CDN da fonte bloqueando o IP do datacenter, que é o risco
        do ADR#4) fica invisível: o log vive no container, atrás do SSH. O
        painel lê daqui.
        """
        self.post("/admin/ingest", {
            "rodadas": rodadas,
            "clubes_ok": clubes_ok,
            "clubes_falhos": clubes_falhos,
            "partidas_novas": partidas_novas,
            "snapshots": snapshots,
            "bootstrap_feito": bootstrap_feito,
            "ultimo_erro": ultimo_erro,
        })

    # --- fila de fetch sob demanda ----------------------------------------

    def list_pending_fetches(self) -> list[dict[str, Any]]:
        """Os alvos (clube ou jogador) que a SPA pediu e ninguém buscou ainda.

        É a ponte entre o clique na tela (que grava o pedido) e este worker:
        nenhum dos dois conhece o outro. É o que faz a tela ser útil -- sem
        isto ela esperaria o ciclo de 15 min para ver qualquer dado.
        """
        data = self.get("/fetch-pending") or {}
        return data.get("pendentes") or []

    def clubs_do_jogador(self, player_id: str) -> list[str]:
        """Os clubes onde um jogador apareceu.

        A fonte não tem endpoint de jogador: o dado dele vem das partidas dos
        clubes onde jogou. É esta lista que traduz "syncar jogador" em
        trabalho real.
        """
        data = self.get(f"/players/{urllib.parse.quote(player_id)}/clubs") or {}
        return [str(c) for c in (data.get("clubes") or [])]

    def save_fetch_run(self, alvo: str, alvo_id: str, *, rodando: bool, jogadores: int,
                       partidas: int, clubes: int = 0, rotulo: str = "",
                       erro: str = "", concluido: bool = False) -> None:
        self.post("/fetch-run/result", {
            "alvo": alvo,
            "alvo_id": alvo_id,
            "rotulo": rotulo,
            "rodando": rodando,
            "jogadores": jogadores,
            "partidas": partidas,
            "clubes": clubes,
            "erro": erro,
            "concluido": concluido,
        })

    # --- fila de busca ao vivo --------------------------------------------

    def list_pending_searches(self) -> list[dict[str, Any]]:
        """Os termos que a tela de resgate pediu para buscar na fonte.

        A busca do hub é local; esta fila é a saída para um clube que ainda
        não está na base -- sem ela, quem chega novo procura pelo próprio
        clube e não acha nada, sem saber por quê.
        """
        data = self.get("/search-pending") or {}
        return data.get("pendentes") or []

    def save_search_run(self, termo: str, *, rodando: bool, encontrados: int,
                        erro: str = "", concluido: bool = False) -> None:
        self.post("/search-run/result", {
            "termo": termo,
            "rodando": rodando,
            "encontrados": encontrados,
            "erro": erro,
            "concluido": concluido,
        })
