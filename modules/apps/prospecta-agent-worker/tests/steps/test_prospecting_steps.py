"""Steps de prospecting.feature.

O domínio é um RabbitMQ real (o teste publica no fanout ``domain.events`` como o
domain-worker faria); a busca, o enriquecimento, o 9router e a prospecta-api são
upstreams HTTP reais (container). O worker é o de verdade: o que se verifica é a
máquina de estados e a travessia de rede, não um dublê.
"""

from __future__ import annotations

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from steps.support import (
    EventCollector,
    build_worker,
    collected_events,
    consume_domain_one,
    delete_domain_queue,
    domain_envelope,
    prospect_requested_envelope,
    publish_domain_event,
    unique_domain_queue,
)

scenarios("../features/prospecting.feature")


@pytest.fixture
def contexto() -> dict:
    return {}


@pytest.fixture
def collector(rabbit_url):
    c = EventCollector(rabbit_url)
    c.open()
    try:
        yield c
    finally:
        c.close()


@pytest.fixture
def domain_queue(rabbit_url):
    name = unique_domain_queue()
    try:
        yield name
    finally:
        delete_domain_queue(rabbit_url, name)


@given(parsers.parse('uma campanha "{campaign_id}" com o ICP "{icp}"'))
def campanha_com_icp(contexto: dict, stubs, campaign_id: str, icp: str) -> None:
    stubs["set"](
        campaigns={
            campaign_id: {
                "id": campaign_id,
                "tenant_id": "tenant-1",
                "company_id": "comp-1",
                "icp": {"definition": icp, "signals": [icp]},
                "channels": ["whatsapp"],
            }
        },
        search={"status": 200, "results": [], "calls": []},
        enrich={"status": 200, "company": {}, "calls": []},
        ninerouter={"status": 200, "fail_times": 0, "calls": [], "contents": []},
        runs=[],
        run_updates=[],
    )
    contexto["stubs"] = stubs
    contexto["campaign_id"] = campaign_id


@given(parsers.parse('que a busca devolve o prospect "{name}" em "{url}"'))
def busca_resultado(contexto: dict, name: str, url: str) -> None:
    resultados = contexto["stubs"]["get"]()["search"].get("results") or []
    resultados.append({"title": name, "url": url, "snippet": "prospect"})
    contexto["stubs"]["set"](search={"status": 200, "results": resultados, "calls": []})


@given(parsers.parse('que a busca devolve "{name}" e de novo "{name2}"'))
def busca_duplicado(contexto: dict, name: str, name2: str) -> None:
    url = "https://northwindlog.com.br"
    contexto["stubs"]["set"](
        search={"status": 200, "results": [
            {"title": name, "url": url, "snippet": "prospect"},
            {"title": name2, "url": url, "snippet": "prospect"},
        ], "calls": []}
    )


@given("que a busca não devolve resultados")
def busca_vazia(contexto: dict) -> None:
    contexto["stubs"]["set"](search={"status": 200, "results": [], "calls": []})


@given(parsers.parse('que a busca não está configurada'))
def busca_nao_configurada(contexto: dict) -> None:
    # Sem chave (`SEARCH_API_KEY=""`) a WebSearch devolve [] sem tocar a rede.
    contexto["search_api_key"] = ""


@given(parsers.parse('que a campanha "{campaign_id}" pertence ao tenant "{tenant_id}"'))
def campanha_do_tenant(contexto: dict, campaign_id: str, tenant_id: str) -> None:
    campaigns = contexto["stubs"]["get"]()["campaigns"]
    campaign = dict(campaigns[campaign_id])
    campaign["tenant_id"] = tenant_id
    contexto["stubs"]["set"](campaigns={**campaigns, campaign_id: campaign})


@given(parsers.parse('que o evento carrega o tenant "{tenant_id}"'))
def evento_carrega_tenant(contexto: dict, tenant_id: str) -> None:
    contexto["event_tenant"] = tenant_id


@given(parsers.parse('que o enriquecimento devolve a empresa "{name}" com o decisor "{decisor}"'))
def enrich_resultado(contexto: dict, name: str, decisor: str) -> None:
    contexto["stubs"]["set"](
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


@given(parsers.parse('que o 9router devolve o fit {fit:d} para o lead'))
def ninerouter_fit(contexto: dict, fit: int) -> None:
    rt = contexto["stubs"]["get"]()["ninerouter"]
    contexto["stubs"]["set"](
        ninerouter={"status": 200, "fail_times": 0, "calls": [], "contents": [f'{{"fit": {fit}}}']}
    )
    contexto["fit"] = fit


@given("que o 9router responde 500 permanentemente")
def ninerouter_500(contexto: dict) -> None:
    contexto["stubs"]["set"](
        ninerouter={"status": 500, "fail_times": 0, "calls": [], "contents": []}
    )


@when(parsers.parse('o domínio publica o evento "ProspectRequested" para a campanha "{campaign_id}"'))
def publica_prospect_requested(contexto: dict, rabbit_url, collector, domain_queue, campaign_id: str) -> None:
    contexto["collector"] = collector
    worker = build_worker(
        contexto["stubs"]["base"],
        rabbit_url,
        search_api_key=contexto.get("search_api_key", "test-search-key"),
    )
    contexto["worker"] = worker
    publish_domain_event(
        rabbit_url,
        prospect_requested_envelope(campaign_id, tenant_id=contexto.get("event_tenant", "tenant-1")),
        queue=domain_queue,
    )
    consume_domain_one(rabbit_url, worker, queue=domain_queue)


@when(parsers.parse('o domínio publica o evento "ProspectRequested" duas vezes para a campanha "{campaign_id}"'))
def publica_prospect_requested_duas(contexto: dict, rabbit_url, collector, domain_queue, campaign_id: str) -> None:
    contexto["collector"] = collector
    worker = build_worker(
        contexto["stubs"]["base"],
        rabbit_url,
        search_api_key=contexto.get("search_api_key", "test-search-key"),
    )
    contexto["worker"] = worker
    envelope = prospect_requested_envelope(campaign_id, tenant_id=contexto.get("event_tenant", "tenant-1"))
    publish_domain_event(rabbit_url, envelope, queue=domain_queue)
    publish_domain_event(rabbit_url, envelope, queue=domain_queue)
    consume_domain_one(rabbit_url, worker, queue=domain_queue)
    consume_domain_one(rabbit_url, worker, queue=domain_queue)


@then(parsers.parse('o worker publicou o evento "{event_type}"'))
def publicou_evento(contexto: dict, event_type: str) -> None:
    events = collected_events(contexto)
    matched = [e for e in events if e.get("event_type") == event_type]
    assert matched, f"esperava {event_type} entre {[e.get('event_type') for e in events]}"


@then(parsers.parse('o worker publicou o evento "{event_type}" com fit {fit:d}'))
def publicou_evento_fit(contexto: dict, event_type: str, fit: int) -> None:
    events = collected_events(contexto)
    matched = [e for e in events if e.get("event_type") == event_type]
    assert matched, f"esperava {event_type} entre {[e.get('event_type') for e in events]}"
    assert matched[-1].get("payload", {}).get("fit") == fit, matched[-1]


@then(parsers.parse('o worker publicou o evento "{event_type}" uma vez'))
def publicou_evento_uma_vez(contexto: dict, event_type: str) -> None:
    events = collected_events(contexto)
    matched = [e for e in events if e.get("event_type") == event_type]
    assert len(matched) == 1, f"esperava 1 {event_type}, veio {len(matched)}"


# Eventos que o worker PRODUZ (o coletor também vê o input do teste, porque o
# fanout entrega a todas as filas -- só o output conta como "o worker publicou").
_AGENT_OUTPUT = frozenset(
    {"LeadDiscovered", "LeadEnriched", "LeadQualified", "MessageDrafted", "MessageSent", "MessageBlocked"}
)


@then("o worker não publicou nenhum evento")
def nenhum_evento(contexto: dict) -> None:
    events = collected_events(contexto, timeout=1.5)
    produced = [e for e in events if e.get("event_type") in _AGENT_OUTPUT]
    assert produced == [], f"esperava silêncio, veio {[e.get('event_type') for e in produced]}"


@then(parsers.parse('o run da campanha "{campaign_id}" terminou no estado "{state}"'))
def run_terminou(contexto: dict, campaign_id: str, state: str) -> None:
    updates = contexto["stubs"]["get"]()["run_updates"]
    states = [u.get("state") for u in updates]
    assert state in states, f"esperava run em {state}, veio {states}"


@then(parsers.parse('a prospecta-api registrou {count:d} run para a campanha "{campaign_id}"'))
def runs_registrados(contexto: dict, count: int, campaign_id: str) -> None:
    runs = contexto["stubs"]["get"]()["runs"]
    matched = [r for r in runs if r.get("campaign_id") == campaign_id]
    assert len(matched) == count, f"esperava {count} run(s), veio {len(matched)}: {matched}"


@then("o worker NÃO abriu um novo run")
def nao_abriu_run(contexto: dict) -> None:
    runs = contexto["stubs"]["get"]()["runs"]
    assert runs == [], f"o worker não deve abrir run (o domínio cria); veio {runs}"


@then(parsers.parse('o run do evento "{run_id}" recebeu o estado "{state}"'))
def run_do_evento_recebeu(contexto: dict, run_id: str, state: str) -> None:
    updates = contexto["stubs"]["get"]()["run_updates"]
    states = [u.get("state") for u in updates if u.get("run_id") == run_id]
    assert state in states, f"esperava run {run_id} em {state}, veio {states}"


@then(parsers.parse('o run do evento "{run_id}" recebeu o estado "{state}" uma vez'))
def run_do_evento_recebeu_uma_vez(contexto: dict, run_id: str, state: str) -> None:
    updates = contexto["stubs"]["get"]()["run_updates"]
    matched = [u for u in updates if u.get("run_id") == run_id and u.get("state") == state]
    assert len(matched) == 1, f"esperava run {run_id} em {state} uma vez, veio {len(matched)}: {updates}"


@then(parsers.parse('o run do evento "{run_id}" terminou no estado "{state}" com found {found:d}'))
def run_do_evento_com_found(contexto: dict, run_id: str, state: str, found: int) -> None:
    updates = contexto["stubs"]["get"]()["run_updates"]
    matched = [
        u
        for u in updates
        if u.get("run_id") == run_id and u.get("state") == state and (u.get("metrics") or {}).get("found") == found
    ]
    assert matched, f"esperava run {run_id} em {state} com found={found}, veio {updates}"


@then(parsers.parse('o lead "{company}" foi persistido na prospecta-api'))
def lead_persistido(contexto: dict, company: str) -> None:
    upserts = contexto["stubs"]["get"]()["lead_upserts"]
    matched = [u for u in upserts if u.get("company_name") == company]
    assert matched, f"esperava upsert do lead {company}, veio {upserts}"


@then(parsers.parse('o lead "{company}" foi qualificado com fit {fit:d}'))
def lead_qualificado(contexto: dict, company: str, fit: int) -> None:
    stubs = contexto["stubs"]["get"]()
    matched = [u for u in stubs["lead_upserts"] if u.get("company_name") == company]
    assert matched, f"esperava upsert do lead {company}, veio {stubs['lead_upserts']}"
    lead_id = matched[-1].get("id")
    qualifies = [q for q in stubs["qualify_calls"] if q.get("lead_id") == lead_id]
    assert qualifies, f"esperava qualify do lead {lead_id}, veio {stubs['qualify_calls']}"
    assert qualifies[-1].get("fit") == fit, qualifies[-1]


@then("o 9router recebeu menos de 10 chamadas")
def ninerouter_menos_de_10(contexto: dict) -> None:
    calls = contexto["stubs"]["get"]()["ninerouter"]["calls"]
    assert len(calls) < 10, f"retry infinito suspeito: {len(calls)}"


# ---------------------------------------------------------------- composer

@given(parsers.parse('um lead "{lead_id}" no canal "{channel}" com tom "{tone}"'))
def lead_para_composer(contexto: dict, stubs, lead_id: str, channel: str, tone: str) -> None:
    stubs["set"](
        lead_details={
            lead_id: {
                "id": lead_id,
                "tenant_id": "tenant-1",
                "campaign_id": "camp-1",
                "company_name": "Northwind Log",
                "channel": channel,
                "tone": tone,
                "phone": "5521981962914",
                "email": "carlos@northwind.com.br",
                "status": "qualified",
            }
        },
        ninerouter={"status": 200, "fail_times": 0, "calls": [], "contents": []},
    )
    contexto["stubs"] = stubs


@given("que o 9router responde com sucesso")
def ninerouter_sucesso(contexto: dict, stubs) -> None:
    stubs["set"](ninerouter={"status": 200, "fail_times": 0, "calls": [], "contents": []})
    contexto["stubs"] = stubs


@when(parsers.parse('o domínio publica o evento "LeadQualified" para o lead "{lead_id}"'))
def publica_lead_qualified(contexto: dict, rabbit_url, collector, domain_queue, lead_id: str) -> None:
    contexto["collector"] = collector
    worker = build_worker(contexto["stubs"]["base"], rabbit_url)
    contexto["worker"] = worker
    publish_domain_event(
        rabbit_url,
        domain_envelope(
            "LeadQualified",
            {"lead_id": lead_id, "tenant_id": contexto.get("event_tenant", "tenant-1"), "fit": 87, "status": "qualified"},
            event_id=f"evt-q-{lead_id}",
            command_id=f"cmd-q-{lead_id}",
        ),
        queue=domain_queue,
    )
    consume_domain_one(rabbit_url, worker, queue=domain_queue)


@then("a mensagem redigida tem rodapé de opt-out")
def mensagem_tem_rodape(contexto: dict) -> None:
    events = collected_events(contexto)
    drafted = [e for e in events if e.get("event_type") == "MessageDrafted"]
    assert drafted, f"esperava MessageDrafted entre {[e.get('event_type') for e in events]}"
    content = drafted[-1].get("payload", {}).get("content", "")
    assert "SAIR" in content or "opt-out" in content.lower(), content


@then("a mensagem redigida foi persistida na prospecta-api")
def mensagem_persistida(contexto: dict) -> None:
    upserts = contexto["stubs"]["get"]()["message_upserts"]
    assert upserts, "esperava POST /messages (mensagem persistida), veio []"
    assert upserts[-1].get("content"), upserts[-1]


@then(parsers.parse('a chamada ao 9router não contém o telefone "{phone}"'))
def chamada_sem_telefone(contexto: dict, phone: str) -> None:
    import json as _json

    calls = contexto["stubs"]["get"]()["ninerouter"]["calls"]
    assert calls, "nenhuma chamada chegou ao 9router"
    raw = _json.dumps(calls[-1]["messages"])
    assert phone not in raw, raw


# ------------------------------------------------- tenant do evento (X-Tenant-Id)


@then(parsers.parse('a prospecta-api leu a campanha "{campaign_id}" no tenant "{tenant_id}"'))
def campanha_lida_no_tenant(contexto: dict, campaign_id: str, tenant_id: str) -> None:
    reads = contexto["stubs"]["get"]()["campaign_reads"]
    matched = [r for r in reads if r.get("campaign_id") == campaign_id]
    assert matched, f"esperava leitura da campanha {campaign_id}, veio {reads}"
    assert matched[-1].get("tenant_id") == tenant_id, f"GET /campaigns sem X-Tenant-Id do evento: {matched[-1]}"


@then(parsers.parse('a prospecta-api persistiu o lead no tenant "{tenant_id}"'))
def lead_persistido_no_tenant(contexto: dict, tenant_id: str) -> None:
    upserts = contexto["stubs"]["get"]()["lead_upserts"]
    assert upserts, "esperava POST /leads, veio []"
    assert upserts[-1].get("tenant_id") == tenant_id, f"POST /leads sem X-Tenant-Id do evento: {upserts[-1]}"


@then(parsers.parse('a prospecta-api qualificou o lead no tenant "{tenant_id}"'))
def lead_qualificado_no_tenant(contexto: dict, tenant_id: str) -> None:
    calls = contexto["stubs"]["get"]()["qualify_calls"]
    assert calls, "esperava POST /leads/{id}/qualify, veio []"
    assert calls[-1].get("tenant_id") == tenant_id, f"POST /leads/{{id}}/qualify sem X-Tenant-Id: {calls[-1]}"


@then(parsers.parse('a prospecta-api atualizou o run "{run_id}" no tenant "{tenant_id}"'))
def run_atualizado_no_tenant(contexto: dict, run_id: str, tenant_id: str) -> None:
    updates = contexto["stubs"]["get"]()["run_updates"]
    matched = [u for u in updates if u.get("run_id") == run_id]
    assert matched, f"esperava updates do run {run_id}, veio {updates}"
    assert all(u.get("tenant_id") == tenant_id for u in matched), f"POST /agent/runs sem X-Tenant-Id: {matched}"


@then(parsers.parse('a prospecta-api leu o lead "{lead_id}" no tenant "{tenant_id}"'))
def lead_lido_no_tenant(contexto: dict, lead_id: str, tenant_id: str) -> None:
    reads = contexto["stubs"]["get"]()["lead_reads"]
    matched = [r for r in reads if r.get("lead_id") == lead_id]
    assert matched, f"esperava GET /leads/{lead_id}, veio {reads}"
    assert matched[-1].get("tenant_id") == tenant_id, f"GET /leads/{{id}} sem X-Tenant-Id do evento: {matched[-1]}"


@then(parsers.parse('a prospecta-api persistiu a mensagem no tenant "{tenant_id}"'))
def mensagem_persistida_no_tenant(contexto: dict, tenant_id: str) -> None:
    upserts = contexto["stubs"]["get"]()["message_upserts"]
    assert upserts, "esperava POST /messages, veio []"
    assert upserts[-1].get("tenant_id") == tenant_id, f"POST /messages sem X-Tenant-Id do evento: {upserts[-1]}"
