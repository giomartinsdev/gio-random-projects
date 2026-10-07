"""A máquina de estados do run de prospecção (research R1, task T035).

O run é ``plan → search → enrich → qualify``, dirigido pelo evento
``ProspectRequested`` do exchange ``domain.events``. Não é um framework: cada
transição é explícita, publica evento e persiste o estado do run na
prospecta-api -- o estado vive no banco, nunca na memória do processo (R1).

O run JÁ é criado pelo domínio: o ``ProspectRequested`` carrega o ``run_id`` e
o worker só o **atualiza** (``POST /agent/runs/{id}``), nunca abre um segundo.

Três propriedades que os testes fixam:

1. **Idempotência** por ``event_id``/``command_id``: a reentrega at-least-once do
   mesmo ``ProspectRequested`` não conduz o run duas vezes.
2. **Dedup** de leads pela chave natural ``domain+company_name`` (R4): o mesmo
   negócio não vira dois leads nem dentro do run nem entre runs.
3. **Nunca loop infinito**: um erro persistente de dependência de IA/
   enriquecimento marca o run ``failed`` e retorna; o retry é do cliente
   (backoff limitado) + circuit-breaker por dependência -- a fila não trava.
   A busca, porém, degrada **honesto**: não configurada ou sem resultados
   termina o run em ``done`` com ``found=0``, nunca em loop de ``failed``.

Além de publicar ``LeadDiscovered``/``LeadEnriched``/``LeadQualified`` no bus, o
lead é **PERSISTIDO** na prospecta-api (``POST /leads`` + ``POST /leads/{id}/
qualify``): a publicação é observabilidade, a persistência é a que conta.
"""

from __future__ import annotations

import logging
import time
from urllib.parse import urlparse

from prospecta_agent_worker.agents.qualifier import Qualifier
from prospecta_agent_worker.agents.tools import EnrichCompany, ToolError, WebScrape, WebSearch
from prospecta_agent_worker.bus import EventPublisher
from prospecta_agent_worker.clients.prospecta_api import ProspectaApiClient
from prospecta_agent_worker.gateway.ninerouter import NineRouterClient, NineRouterError

log = logging.getLogger("prospecta-agent-worker")


class CircuitBreaker:
    """Circuit-breaker simples por dependência (R1).

    Após ``threshold`` falhas consecutivas, o circuito abre por ``cooldown``
    segundos: novas chamadas falham rápido (``CircuitOpen``) em vez de bater na
    dependência já tombada. Uma chamada bem-sucedida fecha o circuito.
    """

    def __init__(self, *, threshold: int = 3, cooldown: float = 30.0) -> None:
        self._threshold = threshold
        self._cooldown = cooldown
        self._failures = 0
        self._opened_at = 0.0

    def allow(self) -> bool:
        if self._opened_at and (time.monotonic() - self._opened_at) < self._cooldown:
            return False
        return True

    def record_success(self) -> None:
        self._failures = 0
        self._opened_at = 0.0

    def record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self._threshold:
            self._opened_at = time.monotonic()

    @property
    def open(self) -> bool:
        return not self.allow()


class CircuitOpen(ToolError):
    """A dependência está com o circuito aberto; falha rápido, sem bater nela."""


def natural_key(domain: str, company_name: str) -> str:
    """A chave de dedup (R4): ``domain+company_name``, normalizada."""
    return f"{(domain or '').strip().lower()}|{(company_name or '').strip().lower()}"


def domain_from_url(url: str) -> str:
    try:
        return urlparse(url).netloc.lower()
    except ValueError:
        return ""


class Orchestrator:
    def __init__(
        self,
        *,
        api: ProspectaApiClient,
        events: EventPublisher,
        ninerouter: NineRouterClient,
        search: WebSearch,
        enrich: EnrichCompany,
        scrape: WebScrape | None = None,
        qualifier: Qualifier | None = None,
    ) -> None:
        self._api = api
        self._events = events
        self._search = search
        self._enrich = enrich
        self._scrape = scrape
        self._qualifier = qualifier or Qualifier(ninerouter=ninerouter, events=events)
        self._search_breaker = CircuitBreaker()
        self._enrich_breaker = CircuitBreaker()
        self._ai_breaker = CircuitBreaker()
        # Idempotência por evento: a reentrega não abre um segundo run.
        self._seen: set[str] = set()
        # Dedup por chave natural: um negócio já visto não vira um segundo lead.
        self._seen_keys: set[str] = set()

    async def handle_prospect_requested(self, event: dict) -> None:
        payload = event.get("payload") or {}
        campaign_id = payload.get("campaign_id")
        tenant_id = payload.get("tenant_id")
        if not isinstance(campaign_id, str) or not campaign_id:
            return
        if not isinstance(tenant_id, str) or not tenant_id:
            return

        dedup_key = str(event.get("event_id") or event.get("command_id") or f"{campaign_id}:{event.get('occurred_at')}")
        if dedup_key in self._seen:
            return
        self._seen.add(dedup_key)

        # O run JÁ existe: o domínio criou no `ProspectRequested`. Nunca abrimos
        # um segundo (POST /agent/runs é do domínio, não do worker).
        run_id = str(payload.get("run_id") or "")
        metrics: dict = {"found": 0, "enriched": 0, "qualified": 0}

        try:
            campaign = await self._api.get_campaign(campaign_id) or {}
            icp = campaign.get("icp") or {}
            campaign_tenant = campaign.get("tenant_id") or tenant_id
            channels = campaign.get("channels") or []

            await self._api.update_run(run_id, state="running", metrics=metrics)
            results = await self._search_guarded(str(icp.get("definition") or ""))

            await self._api.update_run(run_id, state="running", metrics=metrics)
            for result in results:
                key = natural_key(domain_from_url(result.get("url", "")), result.get("title", ""))
                if key in self._seen_keys:
                    continue  # dedup: o mesmo negócio não vira dois leads
                self._seen_keys.add(key)
                metrics["found"] += 1
                lead = {
                    "campaign_id": campaign_id,
                    "company_name": result.get("title", ""),
                    "domain": domain_from_url(result.get("url", "")),
                    "source_url": result.get("url", ""),
                    "channel": channels[0] if channels else "whatsapp",
                }
                # Persistência primeiro: o id que vale é o do domínio (upsert
                # idempotente pela chave natural). A publicação no bus é o
                # mesmo evento, mas a persistência é a que conta.
                lead_id = await self._api.upsert_lead(
                    campaign_id=campaign_id,
                    company_name=lead["company_name"],
                    domain=lead["domain"],
                    channel=lead["channel"],
                    source_url=lead["source_url"],
                )
                if not lead_id:
                    # Sem id do domínio não há como qualificar/ligar mensagens;
                    # a chave determinística antiga era um paliativo, não um id.
                    continue
                payload_lead = {**lead, "lead_id": lead_id}
                await self._qualifier.publish_discovered(lead=payload_lead, tenant_id=campaign_tenant)

                enriched = await self._enrich_guarded(lead["domain"])
                metrics["enriched"] += 1
                await self._qualifier.publish_enriched(
                    lead_id=lead_id, tenant_id=campaign_tenant, enriched=enriched
                )

                try:
                    fit = await self._ai_guarded(icp=icp, lead=payload_lead, enriched=enriched)
                except NineRouterError as exc:
                    # A IA só pontua: se o 9router está fora/sem chave, o lead JÁ
                    # está persistido (upsert acima). Degrada para fit=0 (revisão
                    # humana) e segue, em vez de matar o run inteiro por causa do
                    # scoring. A busca e a persistência continuam valendo.
                    fit = 0
                    metrics["ai_unavailable"] = 1
                    log.warning("qualificação indisponível (9router): %s; lead %s fica com fit=0", exc, lead_id)
                metrics["qualified"] += 1
                # O fit também é persistência, não só evento (R4: upsert).
                await self._api.qualify_lead(lead_id, fit)
                await self._qualifier.publish_qualified(lead_id=lead_id, tenant_id=campaign_tenant, fit=fit)

            await self._api.update_run(run_id, state="done", metrics=metrics)
        except (ToolError, NineRouterError) as exc:
            # Falha persistente de uma dependência: o run termina em failed e
            # NÃO loopa. A fila segue; o humano vê o run vermelho no cockpit.
            metrics["error"] = str(exc)[:200]
            await self._api.update_run(run_id, state="failed", metrics=metrics)
            log.warning("run da campanha %s falhou: %s", campaign_id, exc)

    # ------------------------------------------------------- passos guardados
    async def _search_guarded(self, query: str) -> list[dict]:
        if not self._search_breaker.allow():
            raise CircuitOpen("web.search com circuito aberto")
        try:
            results = await self._search.search(query)
        except ToolError:
            self._search_breaker.record_failure()
            raise
        self._search_breaker.record_success()
        return results

    async def _enrich_guarded(self, domain: str) -> dict:
        if not self._enrich_breaker.allow():
            raise CircuitOpen("enrich.company com circuito aberto")
        try:
            enriched = await self._enrich.enrich(domain)
        except ToolError:
            self._enrich_breaker.record_failure()
            raise
        self._enrich_breaker.record_success()
        return enriched

    async def _ai_guarded(self, *, icp: dict, lead: dict, enriched: dict) -> int:
        if not self._ai_breaker.allow():
            raise CircuitOpen("9router com circuito aberto")
        try:
            fit = await self._qualifier.compute_fit(icp=icp, lead=lead, enriched=enriched)
        except NineRouterError:
            self._ai_breaker.record_failure()
            raise
        self._ai_breaker.record_success()
        return fit
