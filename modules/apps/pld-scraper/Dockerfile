# Python worker image. Build context is the repo root (python-ci-cd.yml
# sets it) because the image also bakes the shared deals_common lib --
# there's no private python registry here and vendoring the lib per app
# keeps `docker build` self-contained regardless of host networking.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN useradd --create-home app
WORKDIR /app

COPY modules/libs/deals_common /tmp/deals_common
COPY modules/apps/pld-scraper /tmp/app
RUN pip install --no-cache-dir /tmp/deals_common /tmp/app \
    && rm -rf /tmp/deals_common /tmp/app

USER app
# The worker imports scrapling -- whose optional-but-unconditionally-
# imported deps come from the app's dependency list (see pyproject).
ENTRYPOINT ["python", "-m", "pld_scraper.main"]