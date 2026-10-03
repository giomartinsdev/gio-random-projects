# finance-api: the finance bounded context's ACL. It validates the WhatsApp
# worker's commands, translates them into the house {action, payload}
# envelope and relays them to domain-api, which owns persistence. It has NO
# database and NO broker -- see spec §1.1 and the static test that enforces it
# (tests/test_isolation.py).
#
# Build context is the REPO ROOT (python-ci-cd.yml sets it), not this app
# directory: the shared contract lives at packages/finance-contracts, which is
# a path above this app. A context of the app dir itself could not reach it.
# There is no private PyPI here, so both packages install straight from source.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN useradd --create-home app
WORKDIR /app

# The shared contract is copied to /tmp alongside the app so a single pip
# invocation resolves finance-contracts from its source and installs the app
# in the same resolver pass.
COPY packages/finance-contracts /tmp/finance-contracts
COPY modules/apps/finance-api /tmp/app

# No `|| true`: if the install fails the image must fail to build, because a
# silently skipped install is a container that starts and then 502s on every
# request.
RUN pip install --no-cache-dir /tmp/finance-contracts /tmp/app \
    && rm -rf /tmp/finance-contracts /tmp/app

USER app
ENTRYPOINT ["python", "-m", "finance_api.main"]
