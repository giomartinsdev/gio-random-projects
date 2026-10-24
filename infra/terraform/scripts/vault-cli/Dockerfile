# Pre-bakes what seed_vault.sh/fetch_vault_secret.sh used to install
# fresh on every single invocation: `apk add openssl jq` plus
# `npm install -g @bitwarden/cli` inside a throwaway node:20-alpine
# container. That install was the actual cost of "talking to the
# vault" in CI (tens of seconds per call, twice per app pipeline run)
# -- the login/unlock/get-item calls that follow it are fast. Baking
# it once here turns every future call back into just `docker run` on
# an image the VPS already has cached.
#
# Rebuild and push (from the VPS itself -- it's already arm64, so no
# QEMU/buildx cross-compile needed) whenever bumping the CLI version:
#   docker build -t registry.giomartins.dev:5000/vault-cli:latest .
#   docker push registry.giomartins.dev:5000/vault-cli:latest
FROM node:20-alpine
RUN apk add --no-cache openssl jq && \
    npm install -g @bitwarden/cli && \
    npm cache clean --force
