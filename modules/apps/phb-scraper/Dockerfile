# Same recipe as pld-scraper's Dockerfile (repo-root context so the
# shared deals_common lib bakes in; python-only, no browsers).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN useradd --create-home app
WORKDIR /app

COPY modules/libs/deals_common /tmp/deals_common
COPY modules/apps/phb-scraper /tmp/app
RUN pip install --no-cache-dir /tmp/deals_common /tmp/app \
    && rm -rf /tmp/deals_common /tmp/app

USER app
ENTRYPOINT ["python", "-m", "phb_scraper.main"]