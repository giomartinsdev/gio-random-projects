# finance-openfinance-worker: o conector de Open Finance do financeiro. Em
# background, lê contas + transações do provedor (Polp/Celcoin) e as encaminha
# como comandos à finance-api. NÃO tem banco, NÃO tem broker e NUNCA escreve
# direto — a persistência é do stack `domain` (§1.1).
#
# Build context = RAIZ DO REPO (python-ci-cd.yml), como os outros apps Python:
# o contrato compartilhado vive em packages/finance-contracts, acima do app.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN useradd --create-home app
WORKDIR /app

COPY packages/finance-contracts /tmp/finance-contracts
COPY modules/apps/finance-openfinance-worker /tmp/app

RUN pip install --no-cache-dir /tmp/finance-contracts /tmp/app \
    && rm -rf /tmp/finance-contracts /tmp/app

USER app
ENTRYPOINT ["python", "-m", "finance_openfinance_worker.main"]
