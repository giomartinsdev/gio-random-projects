# finance-customersupport-worker: o worker conversacional do financeiro. Consome os
# eventos do Evolution API (exchange `evolution`, fila
# `evolution.messages.upsert`) e fala com a finance-api por HTTP. NÃO tem
# banco, NÃO tem DATABASE_URL e NÃO publica comando (§1.1).
#
# Build context = RAIZ DO REPO (é o que o python-ci-cd.yml usa): o contrato
# compartilhado vive em packages/finance-contracts, acima deste app.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN useradd --create-home app
WORKDIR /app

COPY packages/finance-contracts /tmp/finance-contracts
COPY modules/apps/finance-customersupport-worker /tmp/app

# Sem `|| true`: instalação que falha tem de quebrar o build, não virar um
# container que sobe e não fala com ninguém.
RUN pip install --no-cache-dir /tmp/finance-contracts /tmp/app \
    && rm -rf /tmp/finance-contracts /tmp/app

USER app
ENTRYPOINT ["python", "-m", "finance_customersupport_worker.main"]
