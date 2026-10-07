"""Steps de tools.feature.

As tools falam HTTP com um upstream real (container) e o ``web.scrape`` também
consulta o ``robots.txt`` do MESMO host antes de ler a página -- o que se prova
é a travessia de rede e a regra de robots, não um mock.
"""

from __future__ import annotations

import asyncio

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

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


@then("a busca devolve uma lista vazia")
def busca_vazia(contexto: dict) -> None:
    assert contexto["error"] is None, contexto["error"]
    assert contexto["results"] == [], contexto["results"]


@then("a busca recebeu 0 chamadas")
def busca_zero_chamadas(contexto: dict) -> None:
    calls = contexto["stubs"]["get"]()["search"]["calls"]
    assert calls == [], f"sem chave a busca não deve tocar a rede, veio {calls}"


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
