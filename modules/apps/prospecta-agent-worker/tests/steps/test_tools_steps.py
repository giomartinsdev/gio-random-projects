"""Steps de tools.feature.

As tools falam HTTP com um upstream real (container) e o ``web.scrape`` também
consulta o ``robots.txt`` do MESMO host antes de ler a página -- o que se prova
é a travessia de rede e a regra de robots, não um mock.
"""

from __future__ import annotations

import asyncio
import sys

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

import prospecta_agent_worker.agents.tools as tools_mod
from prospecta_agent_worker.agents.tools import (
    EnrichCompany,
    RobotsDisallowed,
    ToolError,
    WebScrape,
    WebSearch,
)

scenarios("../features/tools.feature")


@pytest.fixture
def contexto() -> dict:
    return {}


@pytest.fixture
def fake_curl(contexto, monkeypatch):
    """Faz ``import curl_cffi.requests`` resolver para um dublê e limpa o cache.

    Não há como simular fingerprint de TLS; o que se prova é a LÓGICA: quando o
    transporte impersonado está disponível a tool o usa, quando não está cai
    para httpx. O dublê devolve a resposta que o cenário quiser.
    """

    class _Response:
        def __init__(self, status_code: int, text: str):
            self.status_code = status_code
            self.text = text
            self.url = ""
            self.headers = {}
            self.content = text.encode()

        def json(self):
            import json as _json

            return _json.loads(self.text)

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

    class _Exceptions:
        class CurlError(Exception):
            pass

        RequestException = CurlError

    class _Requests:
        exceptions = _Exceptions()
        last_call: dict = {}

        @classmethod
        def get(cls, url, **kwargs):
            cls.last_call = {"url": url, **kwargs}
            return _Response(200, contexto["impersonated_text"])

    fake = type(sys)("curl_cffi")
    fake.requests = _Requests
    monkeypatch.setitem(sys.modules, "curl_cffi", fake)
    monkeypatch.setitem(sys.modules, "curl_cffi.requests", _Requests)
    monkeypatch.setattr(tools_mod, "_HAS_CURL_CFFI", None, raising=False)
    yield _Requests
    monkeypatch.setattr(tools_mod, "_HAS_CURL_CFFI", None, raising=False)


def _run(coro):
    return asyncio.run(coro)


def _scrape(stubs) -> WebScrape:
    return WebScrape(timeout=3)


def _enrich(stubs) -> EnrichCompany:
    return EnrichCompany(base_url=stubs["base"], api_key="test-enrich-key", timeout=3)


@given(parsers.parse('que a busca devolve o resultado "{title}" em "{url}"'))
def busca_devolve(contexto: dict, stubs, title: str, url: str) -> None:
    stubs["set"](search={"status": 200, "results": [{"title": title, "url": url, "snippet": "..."}], "calls": []})
    contexto["stubs"] = stubs


@given("que a busca responde 500 permanentemente")
def busca_500(contexto: dict, stubs) -> None:
    stubs["set"](search={"status": 500, "results": [], "calls": []})
    contexto["stubs"] = stubs


@given("que a busca não está configurada")
def busca_nao_configurada(contexto: dict, stubs) -> None:
    stubs["set"](search={"status": 200, "results": [], "calls": []})
    contexto["stubs"] = stubs
    contexto["search_api_key"] = ""


@when(parsers.parse('a tool web.search busca por "{query}"'))
def quando_busca(contexto: dict, query: str) -> None:
    contexto["error"] = None
    try:
        search = WebSearch(
            base_url=contexto["stubs"]["base"],
            provider="brave",
            api_key=contexto.get("search_api_key", "test-search-key"),
            timeout=3,
        )
        contexto["results"] = _run(search.search(query))
    except Exception as exc:  # noqa: BLE001 -- o cenário negativo espera o erro
        contexto["error"] = exc


@given(parsers.parse('que a busca searxng devolve o resultado "{title}" em "{url}"'))
def busca_searxng_devolve(contexto: dict, stubs, title: str, url: str) -> None:
    stubs["set"](search={"status": 200, "results": [{"title": title, "url": url, "snippet": "..."}], "calls": []})
    contexto["stubs"] = stubs


@given("que a busca searxng não está configurada")
def busca_searxng_sem_base(contexto: dict, stubs) -> None:
    stubs["set"](search={"status": 200, "results": [], "calls": []})
    contexto["stubs"] = stubs
    contexto["searxng_no_base"] = True


@when(parsers.parse('a tool searxng busca por "{query}"'))
def quando_busca_searxng(contexto: dict, query: str) -> None:
    contexto["error"] = None
    base = "" if contexto.get("searxng_no_base") else contexto["stubs"]["base"]
    try:
        search = WebSearch(base_url=base, provider="searxng", api_key="", timeout=3)
        contexto["results"] = _run(search.search(query))
    except Exception as exc:  # noqa: BLE001
        contexto["error"] = exc


@then("a busca devolve uma lista vazia")
def busca_vazia(contexto: dict) -> None:
    assert contexto["error"] is None, contexto["error"]
    assert contexto["results"] == [], contexto["results"]


@then("a busca recebeu 0 chamadas")
def busca_zero_chamadas(contexto: dict) -> None:
    calls = contexto["stubs"]["get"]()["search"]["calls"]
    assert calls == [], f"sem chave a busca não deve tocar a rede, veio {calls}"


@then("a busca recebeu ao menos 1 chamada")
def busca_ao_menos_uma(contexto: dict) -> None:
    calls = contexto["stubs"]["get"]()["search"]["calls"]
    assert calls, "esperava a busca bater no provedor searxng, veio 0 chamadas"


@then(parsers.parse('a busca devolve o título "{title}" e a url "{url}"'))
def busca_devolve_resultado(contexto: dict, title: str, url: str) -> None:
    assert contexto["error"] is None, contexto["error"]
    results = contexto["results"]
    assert results, "esperava ao menos um resultado"
    assert results[0]["title"] == title, results[0]
    assert results[0]["url"] == url, results[0]


@then("a tool levanta um erro de tool")
def tool_ergue(contexto: dict) -> None:
    assert isinstance(contexto["error"], ToolError), contexto["error"]


@then(parsers.parse('a busca devolve o snippet "{snippet}"'))
def busca_devolve_snippet(contexto: dict, snippet: str) -> None:
    assert contexto["error"] is None, contexto["error"]
    assert contexto["results"][0]["snippet"] == snippet, contexto["results"][0]


@then("a busca recebeu menos de 10 chamadas")
def busca_menos_de_10(contexto: dict) -> None:
    calls = contexto["stubs"]["get"]()["search"]["calls"]
    assert len(calls) < 10, f"retry infinito suspeito: {len(calls)}"


@given("que o robots.txt permite a leitura")
def robots_permite(contexto: dict, stubs) -> None:
    stubs["set"](scrape={"html": stubs["get"]()["scrape"]["html"], "robots": "User-agent: *\nAllow: /\n", "calls": []})
    contexto["stubs"] = stubs


@given("que o robots.txt proíbe a leitura")
def robots_proibe(contexto: dict, stubs) -> None:
    stubs["set"](scrape={"html": stubs["get"]()["scrape"]["html"], "robots": "User-agent: *\nDisallow: /pages/\n", "calls": []})
    contexto["stubs"] = stubs


@given(parsers.parse('que a página pública tem o título "{title}" e o texto "{text}"'))
def pagina_publica(contexto: dict, title: str, text: str) -> None:
    html = f"<html><head><title>{title}</title></head><body><h1>{title}</h1><p>{text}</p></body></html>"
    stubs = contexto["stubs"]
    stubs["set"](scrape={"html": html, "robots": stubs["get"]()["scrape"]["robots"], "calls": []})


@when(parsers.parse('a tool web.scrape lê "{url}"'))
def quando_scrape(contexto: dict, url: str) -> None:
    # O domínio do cenário aponta para o host do stub (a travessia de rede é
    # real); o robots.txt é consultado no MESMO host da página.
    url = url.replace("https://northwindlog.com.br", contexto["stubs"]["base"])
    contexto["error"] = None
    try:
        contexto["page"] = _run(_scrape(contexto["stubs"]).fetch(url))
    except Exception as exc:  # noqa: BLE001
        contexto["error"] = exc


@then(parsers.parse('o scrape devolve o título "{title}"'))
def scrape_titulo(contexto: dict, title: str) -> None:
    assert contexto["error"] is None, contexto["error"]
    assert contexto["page"]["meta"]["title"] == title, contexto["page"]


@then(parsers.parse('o scrape devolve o texto contendo "{needle}"'))
def scrape_texto(contexto: dict, needle: str) -> None:
    assert needle in contexto["page"]["text"], contexto["page"]["text"]


@then("a tool levanta um erro de robots")
def robots_ergue(contexto: dict) -> None:
    assert isinstance(contexto["error"], RobotsDisallowed), contexto["error"]


@given("que o transporte impersonado está disponível")
def transporte_disponivel(contexto: dict, stubs, fake_curl) -> None:
    contexto["stubs"] = stubs
    contexto["impersonated_text"] = (
        "<html><head><title>Northwind Log</title></head><body>Frota</body></html>"
    )


@given("que o transporte impersonado não está instalado")
def transporte_indisponivel(contexto: dict, stubs, fake_curl) -> None:
    tools_mod._HAS_CURL_CFFI = False
    stubs["set"](
        scrape={
            "html": "<html><head><title>Northwind Log</title></head><body>Frota</body></html>",
            "robots": "User-agent: *\nAllow: /\n",
            "company_html": stubs["get"]()["scrape"]["company_html"],
            "calls": [],
        }
    )
    contexto["stubs"] = stubs


@then("o scrape usou o transporte impersonado")
def scrape_usou_impersonado(contexto: dict, fake_curl) -> None:
    assert fake_curl.last_call, "esperava curl_cffi impersonando um browser"
    assert fake_curl.last_call.get("impersonate") == "chrome", fake_curl.last_call


@then("o scrape não usou o transporte impersonado")
def scrape_nao_usou_impersonado(contexto: dict, fake_curl) -> None:
    assert fake_curl.last_call == {}, f"httpx deveria ter sido o transporte: {fake_curl.last_call}"


@given(parsers.parse('que o enriquecimento devolve a empresa "{name}" com decisor "{decisor}"'))
def enrich_devolve(contexto: dict, stubs, name: str, decisor: str) -> None:
    stubs["set"](
        enrich={
            "status": 200,
            "company": {
                "name": name,
                "domain": "northwindlog.com.br",
                "decision_maker": decisor,
                "email": "carlos@northwind.com.br",
                "cnpj": "12.345.678/0001-90",
                "segment": "Logística",
            },
            "calls": [],
        }
    )
    contexto["stubs"] = stubs


@when(parsers.parse('a tool enrich.company enriquece o domínio "{domain}"'))
def quando_enrich(contexto: dict, domain: str) -> None:
    contexto["enriched"] = _run(_enrich(contexto["stubs"]).enrich(domain))


@then(parsers.parse('o enriched tem company_name "{name}" e decisor "{decisor}"'))
def enriched_campos(contexto: dict, name: str, decisor: str) -> None:
    assert contexto["enriched"]["company_name"] == name, contexto["enriched"]
    assert contexto["enriched"]["decisor"] == decisor, contexto["enriched"]


@then(parsers.parse('o enriched tem a chave "{key}"'))
def enriched_chave(contexto: dict, key: str) -> None:
    assert key in contexto["enriched"], contexto["enriched"]


# --------------------------------------------------------- enrich por CNPJ (local)

def _company_url(domain: str, stubs) -> str:
    """O domínio do cenário aponta para o host do stub (travessia de rede real)."""
    return f"{stubs['base']}/company/{domain}"


def _set_site(stubs, html: str, status: int = 200) -> None:
    stubs["set"](
        scrape={
            "html": stubs["get"]()["scrape"]["html"],
            "robots": stubs["get"]()["scrape"]["robots"],
            "company_html": html,
            "company_status": status,
            "calls": [],
        }
    )


@given(parsers.parse('que o site da empresa em "{url}" tem o título "{title}"'))
def site_titulo(contexto: dict, stubs, url: str, title: str) -> None:
    _set_site(stubs, f"<html><head><title>{title}</title></head><body></body></html>")
    contexto["stubs"] = stubs
    contexto["cnpj_site_html"] = f"<html><head><title>{title}</title></head><body></body></html>"


@given(parsers.parse('o site traz o e-mail "{email}" e o cnpj "{cnpj}"'))
def site_email_cnpj(contexto: dict, stubs, email: str, cnpj: str) -> None:
    html = contexto["cnpj_site_html"].replace(
        "</body>", f"<p>{email}</p><p>CNPJ {cnpj}</p></body>"
    )
    contexto["cnpj_site_html"] = html
    _set_site(stubs, html)


@given(parsers.parse('o site traz o e-mail "{email}"'))
def site_email(contexto: dict, stubs, email: str) -> None:
    html = contexto["cnpj_site_html"].replace("</body>", f"<p>{email}</p></body>")
    contexto["cnpj_site_html"] = html
    _set_site(stubs, html)


@given(parsers.parse('a Receita devolve a razão social "{razao}" para o cnpj "{cnpj}"'))
def receita_razao(contexto: dict, stubs, razao: str, cnpj: str) -> None:
    # O formato REAL do publica.cnpj.ws: estabelecimento aninhado, estado como
    # objeto, sócios em qsa.
    stubs["set"](
        cnpj={
            "status": 200,
            "company": {
                "razao_social": razao,
                "cnpj": cnpj,
                "estabelecimento": {
                    "nome_fantasia": "Northwind",
                    "situacao_cadastral": "ATIVA",
                    "cnae_fiscal_descricao": "Transporte rodoviário de carga",
                    "municipio": "São Paulo",
                    "estado": {"sigla": "SP"},
                },
                "qsa": [{"nome_socio": "Carlos Menezes"}, {"nome_socio": "Ana Lima"}],
            },
            "calls": [],
        }
    )


@given(parsers.parse('que o site da empresa está fora do ar em "{url}"'))
def site_fora_do_ar(contexto: dict, stubs, url: str) -> None:
    _set_site(stubs, "<html><body>down</body></html>", status=503)
    contexto["stubs"] = stubs


@when(parsers.parse('a tool enrich.company cnpj enriquece o domínio "{domain}"'))
def quando_enrich_cnpj(contexto: dict, domain: str) -> None:
    stubs = contexto["stubs"]
    # Reescreve a base do cnpj_url para o host do stub, e o "domínio" para o
    # caminho /company/<domain> do mesmo host.
    enrich = EnrichCompany(
        base_url=stubs["base"],
        provider="cnpj",
        cnpj_url=stubs["base"] + "/cnpj",
        api_key="",
        timeout=3,
    )
    contexto["error"] = None
    try:
        contexto["enriched"] = _run(enrich.enrich(_company_url(domain, stubs)))
    except Exception as exc:  # noqa: BLE001
        contexto["error"] = exc


@then(parsers.parse('o enriched cnpj tem company_name "{name}" e cnpj "{cnpj}"'))
def enriched_cnpj_campos(contexto: dict, name: str, cnpj: str) -> None:
    assert contexto["error"] is None, contexto["error"]
    assert contexto["enriched"]["company_name"] == name, contexto["enriched"]
    assert contexto["enriched"]["cnpj"] == cnpj, contexto["enriched"]


@then(parsers.parse('o enriched cnpj tem company_name "{name}"'))
def enriched_cnpj_nome(contexto: dict, name: str) -> None:
    assert contexto["error"] is None, contexto["error"]
    assert contexto["enriched"]["company_name"] == name, contexto["enriched"]


@then("o enriched cnpj não tem cnpj")
def enriched_cnpj_sem_cnpj(contexto: dict) -> None:
    assert contexto["enriched"]["cnpj"] == "", contexto["enriched"]


@then("o enriched cnpj está vazio")
def enriched_cnpj_vazio(contexto: dict) -> None:
    assert contexto["error"] is None, contexto["error"]
    enriched = contexto["enriched"]
    assert enriched["company_name"] == "", enriched
    assert enriched["cnpj"] == "", enriched
    assert enriched["email"] == "", enriched


@then(parsers.parse('o enriched cnpj tem email "{email}"'))
def enriched_cnpj_email(contexto: dict, email: str) -> None:
    assert contexto["enriched"]["email"] == email, contexto["enriched"]


@then(parsers.parse('o enriched cnpj tem o decisor "{decisor}" e o segmento contendo "{needle}"'))
def enriched_cnpj_decisor_segmento(contexto: dict, decisor: str, needle: str) -> None:
    assert contexto["enriched"]["decisor"] == decisor, contexto["enriched"]
    assert needle in contexto["enriched"]["segment"], contexto["enriched"]
