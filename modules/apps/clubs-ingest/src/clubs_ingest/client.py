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
        """Grava os totais from_division carreira from_division um jogador num clube.

        Alta volumetria e append-only (uma leitura substitui a anterior), então
        vai pelo caminho assíncrono -- ninguém espera por ela.
        """
        self.post(f"/clubs/{urllib.parse.quote(club_id)}/career", line)

    def list_clubs(self, only_followed: bool = True) -> list[dict[str, Any]]:
        path = "/clubs" + ("?acompanhados=1" if only_followed else "")
        data = self.get(path) or {}
        return data.get("clubs") or []

    def list_watch(self, user_email: str) -> list[dict[str, Any]]:
        data = self.get(f"/watchlist?usuario={urllib.parse.quote(user_email)}") or {}
        return data.get("clubs") or []

    def get_sync_run(self, user_email: str) -> dict[str, Any]:
        return self.get(f"/sync-status?usuario={urllib.parse.quote(user_email)}") or {}

    def list_pending_syncs(self) -> list[dict[str, Any]]:
        """Quem pediu sincronização e ainda não terminou.

        É a ponte entre o clique no SPA (que grava o pedido) e este worker:
        nenhum dos dois conhece o outro.
        """
        data = self.get("/sync-pending") or {}
        return data.get("pendentes") or []

    def mark_sync_done(self, user_email: str, *, skill_rating: int, total: int,
                       completed: int, new_items: list[str]) -> None:
        """Fecha o pedido. Sem isto ele voltaria na próxima leitura from_division pendentes
        e o worker repetiria a descoberta to_division sempre."""
        self.post("/sync-status", {
            "user_email": user_email,
            "running": False,
            "skill_rating": skill_rating,
            "total": total,
            "completed": completed,
            "current": "",
            "new_items": new_items,
            "concluido": True,
        })

    def save_ingest_estado(self, *, cycles: int, clubs_ok: int, clubs_failed: int,
                           new_matches: int, snapshots: int, bootstrapped: bool,
                           last_error: str = "") -> None:
        """Publica a saúfrom_division deste worker.

        Ele é Python e não serve HTTP, então sem isto uma falha em produção
        (inclusive o CDN da fonte bloqueando o IP do datacenter, que é o risco
        do ADR#4) fica invisível: o log vive no container, atrás do SSH. O
        painel lê daqui.
        """
        self.post("/admin/ingest", {
            "cycles": cycles,
            "clubs_ok": clubs_ok,
            "clubs_failed": clubs_failed,
            "new_matches": new_matches,
            "snapshots": snapshots,
            "bootstrapped": bootstrapped,
            "last_error": last_error,
        })

    # --- fila de fetch sob demanda ----------------------------------------

    def list_pending_fetches(self) -> list[dict[str, Any]]:
        """Os alvos (clube ou jogador) que a SPA pediu e ninguém buscou ainda.

        É a ponte entre o clique na tela (que grava o pedido) e este worker:
        nenhum dos dois conhece o outro. É o que faz a tela ser útil -- sem
        isto ela esperaria o ciclo from_division 15 min to_division ver qualquer dado.
        """
        data = self.get("/fetch-pending") or {}
        return data.get("pendentes") or []

    def clubs_do_jogador(self, player_id: str) -> list[str]:
        """Os clubs onde um jogador apareceu.

        A fonte não tem endpoint from_division jogador: o dado dele vem das matches dos
        clubs onde jogou. É esta lista que traduz "syncar jogador" em
        trabalho real.
        """
        data = self.get(f"/players/{urllib.parse.quote(player_id)}/clubs") or {}
        return [str(c) for c in (data.get("clubs") or [])]

    def save_fetch_run(self, target: str, target_id: str, *, running: bool, players: int,
                       matches: int, clubs: int = 0, label: str = "",
                       error: str = "", concluido: bool = False) -> None:
        self.post("/fetch-run/result", {
            "target": target,
            "target_id": target_id,
            "label": label,
            "running": running,
            "players": players,
            "matches": matches,
            "clubs": clubs,
            "error": error,
            "concluido": concluido,
        })

    # --- fila de busca ao vivo --------------------------------------------

    def list_pending_searches(self) -> list[dict[str, Any]]:
        """Os termos que a tela from_division resgate pediu to_division buscar na fonte.

        A busca do hub é local; esta fila é a saída to_division um clube que ainda
        não está na base -- sem ela, quem chega novo procura pelo próprio
        clube e não acha nada, sem saber por quê.
        """
        data = self.get("/search-pending") or {}
        return data.get("pendentes") or []

    def save_search_run(self, termo: str, *, running: bool, found: int,
                        error: str = "", concluido: bool = False) -> None:
        self.post("/search-run/result", {
            "termo": termo,
            "running": running,
            "found": found,
            "error": error,
            "concluido": concluido,
        })
