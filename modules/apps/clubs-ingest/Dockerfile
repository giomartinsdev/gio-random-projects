# clubs-ingest: a background poller, not an HTTP service -- no published port,
# no ingress route, no hostname. It reads the clubs it follows from domain-api,
# fetches their data from the EA Pro Clubs source, and writes back through
# domain-api. No database of its own, same as every service in this repo.
#
# Build context is the REPO ROOT (python-ci-cd.yml sets it), matching
# pld-scraper's own note: there is no private python registry here, so the app
# (and the vendored source client inside it) is installed straight from source.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN useradd --create-home app
WORKDIR /app

COPY modules/apps/clubs-ingest /tmp/app
RUN pip install --no-cache-dir /tmp/app \
    && rm -rf /tmp/app

USER app
ENTRYPOINT ["python", "-m", "clubs_ingest.main"]
