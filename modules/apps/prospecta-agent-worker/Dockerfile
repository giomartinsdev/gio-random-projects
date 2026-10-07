# prospecta-agent-worker: o núcleo agêntico do Prospecta. Consome os eventos de
# domínio (exchange `domain.events`) e o `evolution.messages.upsert`, orquestra
# os agentes, chama o 9router para IA e envia pela Evolution API. NÃO tem porta,
# NÃO tem hostname, NÃO tem banco, NÃO tem DATABASE_URL (§1.1).
#
# Build context = RAIZ DO REPO (é o que o python-ci-cd.yml usa): o contrato
# compartilhado vive em packages/prospecta-contracts, acima deste app.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN useradd --create-home app
WORKDIR /app

COPY packages/prospecta-contracts /tmp/prospecta-contracts
COPY modules/apps/prospecta-agent-worker /tmp/app

# Sem `|| true`: instalação que falha tem de quebrar o build, não virar um
# container que sobe e não fala com ninguém.
RUN pip install --no-cache-dir /tmp/prospecta-contracts /tmp/app \
    && rm -rf /tmp/prospecta-contracts /tmp/app

USER app
# Worker puro: sem EXPOSE, sem PORT -- só o loop de consumo do broker.
ENTRYPOINT ["python", "-m", "prospecta_agent_worker.main"]
