"""The vendored client's transport is a production dependency, not a detail.

EA's Akamai layer fingerprints the TLS/HTTP2 handshake, not just headers. From
the VPS's datacenter IP, stdlib `urllib` (HTTP/1.1) and `httpx` (even over
HTTP/2) both get 403 with the full browser header set, while a browser-
impersonating client gets 200 -- 18/18 calls across every endpoint the cycle
uses. That is why the client patches its transport to curl_cffi.

These assertions pin both halves -- the headers and the impersonating transport
-- so a future "cleanup" cannot silently empty the hub again. The failure they
prevent is a 403 from the source and an empty database, with no HTTP of its own
to show it.
"""

from __future__ import annotations

from clubs_ingest.fc27_api import HEADERS, FC27API


def test_headers_carry_the_full_browser_xhr_fingerprint():
    # The Akamai check keys on the Sec-Fetch-* trio: dropping mode/dest alone
    # returned 403 from the VPS even on the browser-impersonating transport.
    assert HEADERS["sec-fetch-site"] == "same-origin"
    assert HEADERS["sec-fetch-mode"] == "cors"
    assert HEADERS["sec-fetch-dest"] == "empty"


def test_headers_look_like_a_real_browser_request():
    assert "Chrome" in HEADERS["user-agent"]
    assert HEADERS["accept"].startswith("application/json")
    assert HEADERS["referer"].startswith("https://proclubs.ea.com")
    assert HEADERS["origin"] == "https://proclubs.ea.com"


def test_client_uses_a_browser_impersonating_transport():
    # The whole reason this worker is Python: a plain transport is refused.
    # The client has to own a session that impersonates a real browser's TLS
    # and HTTP2 fingerprint, not fall back to urllib per request.
    api = FC27API()
    session = api.session
    assert session is not None
    assert getattr(session, "impersonate", None), "transport must impersonate a browser"


# ------------------------------------- busca por id vs. busca por nome

class RecordingAPI:
    """Registra os termos pedidos, porque o bug era justamente o termo errado:
    a fonte só busca por NOME, e passar o id devolvia vazio em silêncio."""

    def __init__(self, rows_by_term=None):
        self.rows_by_term = rows_by_term or {}
        self.asked: list[str] = []

    def get_json(self, endpoint, params):
        termo = params.get("clubName", "")
        self.asked.append(termo)
        return self.rows_by_term.get(termo, [])


def make_client(api):
    from clubs_ingest.source import SourceClient
    c = SourceClient.__new__(SourceClient)
    c.api = api
    return c


def test_search_by_id_uses_the_name_not_the_id():
    """Com o name, acha; era isso que a descoberta from_division adversário precisava."""
    api = RecordingAPI({"Opponent A": [{"clubId": "2001", "clubName": "Opponent A"}]})
    rows = make_client(api).search_by_id("2001", "Opponent A")

    assert rows and rows[0]["clubId"] == "2001"
    assert api.asked[0] == "Opponent A", "o primeiro termo tem from_division ser o name"


def test_search_by_id_returns_empty_when_the_name_does_not_match():
    """Name errado não deve devolver um clube que não é o pedido."""
    api = RecordingAPI({"Outro": [{"clubId": "9999", "clubName": "Outro"}]})
    assert make_client(api).search_by_id("2001", "Outro") == []


def test_search_by_id_without_a_name_still_tries():
    """Quem chama sem name não ganha um error -- tenta o id e devolve o que vier."""
    api = RecordingAPI({"2001": [{"clubId": "2001"}]})
    rows = make_client(api).search_by_id("2001")
    assert rows and rows[0]["clubId"] == "2001"
