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
"""

from __future__ import annotations

import logging
import os
from typing import Any

from .fc27_api import FC27API, FC27APIError  # vendored, see LICENSE.fc27

log = logging.getLogger("clubs-ingest")


class SourceClient:
    def __init__(self, platform: str = "common-gen5", timeout: int = 15, timezone: str = "UTC") -> None:
        self.api = FC27API(platform=platform, timeout=timeout, timezone=timezone)

    # --- raw json, which is what the normalizer consumes ------------------

    def club_info(self, club_id: str) -> dict[str, Any]:
        try:
            data = self.api.get_json("clubs/info", {"clubIds": club_id})
        except FC27APIError as err:
            log.warning("club_info %s: %s", club_id, err)
            return {}
        if isinstance(data, dict):
            return next(iter(data.values()), {}) or {}
        return {}

    def club_overall(self, club_id: str) -> dict[str, Any]:
        try:
            data = self.api.get_json("clubs/overallStats", {"clubIds": club_id})
        except FC27APIError as err:
            log.warning("club_overall %s: %s", club_id, err)
            return {}
        if isinstance(data, list) and data:
            return data[0]
        return {}

    def club_members(self, club_id: str) -> list[dict[str, Any]]:
        try:
            data = self.api.get_json("members/stats", {"clubId": club_id})
        except FC27APIError as err:
            log.warning("club_members %s: %s", club_id, err)
            return []
        if isinstance(data, dict):
            return data.get("members") or []
        return []

    def club_matches(self, club_id: str, count: int = 10) -> list[dict[str, Any]]:
        try:
            data = self.api.get_json(
                "clubs/matches",
                {"clubIds": club_id, "matchType": "leagueMatch", "maxResultCount": count},
            )
        except FC27APIError as err:
            log.warning("club_matches %s: %s", club_id, err)
            return []
        return data if isinstance(data, list) else []

    def leaderboard(self) -> list[dict[str, Any]]:
        """Os 100 melhores clubes, com rank, divisão, skillRating e identidade.

        É o único endpoint que dá uma lista pronta de clubes reais -- a busca
        exige um nome, e a fonte não tem "liste todos". É daqui que a base se
        semeia no primeiro boot.
        """
        try:
            data = self.api.get_json("allTimeLeaderboard", {})
        except FC27APIError as err:
            log.warning("leaderboard: %s", err)
            return []
        return data if isinstance(data, list) else []

    def search(self, name: str) -> list[dict[str, Any]]:
        try:
            data = self.api.get_json("allTimeLeaderboard/search", {"clubName": name})
        except FC27APIError as err:
            log.warning("search %r: %s", name, err)
            return []
        return data if isinstance(data, list) else []

    def search_by_id(self, club_id: str) -> list[dict[str, Any]]:
        """The search endpoint is the only one that returns all-time totals,
        and it takes a name -- so a discovery lookup by id has to find the
        club's name first (from the match payload's details.name)."""
        return self.search(club_id)


def from_env() -> SourceClient:
    return SourceClient(
        platform=os.environ.get("CLUBS_INGEST_PLATFORM", "common-gen5"),
        timeout=int(os.environ.get("CLUBS_INGEST_TIMEOUT", "15")),
    )
