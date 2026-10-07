"""Entrypoint: ``python -m prospecta_agent_worker.main``.

Lê a configuração uma vez e valida o obrigatório antes de subir: um worker que
sobe sem conseguir falar com o broker, o 9router, a Evolution ou a prospecta-api
é pior que um deploy vermelho -- ele consome a fila e não entrega nada.

ESQUELETO/L-AGENT: o bootstrap (logging + validação de env) já existia; aqui ele
passa a montar o núcleo (gateways + publicador de eventos + consumidor do
Evolution). Os agentes de busca/qualificação/redação entram nas user stories
seguintes.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

from prospecta_agent_worker.agents.tools import EnrichCompany, WebScrape, WebSearch
from prospecta_agent_worker.bus import EventPublisher
from prospecta_agent_worker.clients.prospecta_api import ProspectaApiClient
from prospecta_agent_worker.consumers.domain_events import DomainEventsConsumer
from prospecta_agent_worker.consumers.evolution import EvolutionConsumer
from prospecta_agent_worker.gateway.email import build_email_client
from prospecta_agent_worker.gateway.evolution import EvolutionClient
from prospecta_agent_worker.gateway.ninerouter import NineRouterClient
from prospecta_agent_worker.worker import ProspectaWorker

# Env obrigatórias -- falha de boot se faltar, padrão do worker financeiro.
# PROSPECTA_API_KEY não entra: em dev a prospecta-api deixa passar sem chave.
REQUIRED = (
    "RABBITMQ_URL",
    "EVOLUTION_API_URL",
    "EVOLUTION_API_KEY",
    "NINEROUTER_BASE_URL",
    "PROSPECTA_API_URL",
)


def _configure_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("PROSPECTA_WORKER_LOG_LEVEL", "INFO").upper(),
        format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
        stream=sys.stdout,
    )


def build_worker() -> ProspectaWorker:
    """Monta o núcleo a partir do ambiente (envs já validadas).

    As tools e o e-mail têm envs próprias com defaults sensatos: o 9router é a
    única porta de IA; a busca/enriquecimento apontam para os provedores da
    T036 (``SEARCH_API_URL``/``ENRICH_API_URL``, default no próprio 9router base
    em dev); o e-mail usa ``EMAIL_PROVIDER`` (default ``smtp``).
    """
    ninerouter = NineRouterClient(
        os.environ["NINEROUTER_BASE_URL"],
        os.environ.get("NINEROUTER_API_KEY", ""),
        timeout=float(os.environ.get("NINEROUTER_TIMEOUT_S", "15")),
    )
    return ProspectaWorker(
        evolution=EvolutionClient(
            os.environ["EVOLUTION_API_URL"],
            os.environ["EVOLUTION_API_KEY"],
            os.environ.get("EVOLUTION_INSTANCE", "web-businesses"),
            timeout=float(os.environ.get("EVOLUTION_TIMEOUT_S", "15")),
        ),
        ninerouter=ninerouter,
        api=ProspectaApiClient(
            os.environ["PROSPECTA_API_URL"],
            os.environ.get("PROSPECTA_API_KEY", ""),
            timeout=float(os.environ.get("PROSPECTA_API_TIMEOUT_S", "15")),
        ),
        events=EventPublisher(os.environ["RABBITMQ_URL"]),
        approval_policy=os.environ.get("PROSPECTA_APPROVAL_POLICY", "human"),
        search=WebSearch(
            base_url=os.environ.get("SEARCH_API_URL", os.environ["NINEROUTER_BASE_URL"]),
            provider=os.environ.get("SEARCH_PROVIDER", "brave"),
            api_key=os.environ.get("SEARCH_API_KEY", ""),
        ),
        enrich=EnrichCompany(
            base_url=os.environ.get("ENRICH_API_URL", os.environ["NINEROUTER_BASE_URL"]),
            api_key=os.environ.get("ENRICH_API_KEY", ""),
            provider=os.environ.get("ENRICH_PROVIDER", "cnpj"),
            cnpj_url=os.environ.get("ENRICH_CNPJ_URL", "https://publica.cnpj.ws/cnpj"),
        ),
        scrape=WebScrape(timeout=float(os.environ.get("SCRAPE_TIMEOUT_S", "15"))),
        email=build_email_client(
            os.environ.get("EMAIL_PROVIDER", "smtp"),
            host=os.environ.get("SMTP_HOST", ""),
            port=int(os.environ.get("SMTP_PORT", "587")),
            sender=os.environ.get("EMAIL_SENDER", "agente@prospecta.dev"),
            username=os.environ.get("SMTP_USERNAME", ""),
            password=os.environ.get("SMTP_PASSWORD", ""),
            starttls=os.environ.get("SMTP_STARTTLS", "").lower() in ("1", "true", "yes"),
        ),
    )


def main() -> int:
    _configure_logging()

    missing = [k for k in REQUIRED if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"missing required env: {', '.join(missing)}")

    worker = build_worker()
    rabbit_url = os.environ["RABBITMQ_URL"]

    logging.getLogger("prospecta-agent-worker").info(
        "worker iniciado; instância %s",
        os.environ.get("EVOLUTION_INSTANCE", "web-businesses"),
    )

    async def _serve() -> None:
        # Duas entradas: as respostas do WhatsApp (Evolution) e os eventos de
        # domínio (ProspectRequested/LeadQualified/MessageApproved).
        await asyncio.gather(
            EvolutionConsumer(rabbit_url, worker).run_forever(),
            DomainEventsConsumer(rabbit_url, worker).run_forever(),
        )

    asyncio.run(_serve())
    return 0


if __name__ == "__main__":
    sys.exit(main())
