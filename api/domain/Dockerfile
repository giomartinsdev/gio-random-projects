# Build context is api/ (the parent dir), not this folder — see
# api/README.md and .github/workflows/api-build-push.yml — so this
# Dockerfile can COPY the shared/ telemetry package alongside its own code.

FROM python:3.14-slim

WORKDIR /app

COPY domain/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && opentelemetry-bootstrap -a install

COPY shared shared
COPY domain/app app
COPY domain/main.py .

RUN useradd --create-home appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# opentelemetry-instrument activates the auto-instrumentation packages
# installed above (FastAPI, SQLAlchemy, ...) purely from env vars set at
# run time (OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, ...) — no code
# change needed here to turn tracing on or off. See api/README.md.
CMD ["opentelemetry-instrument", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
