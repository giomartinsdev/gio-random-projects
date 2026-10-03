# syntax=docker/dockerfile:1
#
# computer/Dockerfile — a imagem que cada Dot roda, como camada fina sobre o
# agent-computer upstream do OpenBot (browser headless + workspace + API de
# computador na 4100). Adiciona o que o upstream não traz e o nosso caso prefere:
# git + ssh, e a deploy key do repo de projetos em /root/.ssh, pra cada Dot
# clonar/puxar no próprio /workspace persistente.
#
# A chave NUNCA entra no git nem no contexto de build: vem do segredo de build
# `computer_deploy_key` (variável de stack COMPUTER_DEPLOY_KEY no Dockhand),
# montado só durante o RUN. O contexto de build é `stacks/` (dir do compose).
ARG BASE_IMAGE=opendots-computer:b6932d3
FROM ${BASE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh
RUN printf 'Host github.com\n  IdentityFile /root/.ssh/id_ed25519\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n' \
      > /root/.ssh/config \
  && chmod 600 /root/.ssh/config \
  && ssh-keyscan github.com > /root/.ssh/known_hosts 2>/dev/null \
  && chmod 644 /root/.ssh/known_hosts

RUN --mount=type=secret,id=computer_deploy_key,target=/tmp/deploy_key \
    cp /tmp/deploy_key /root/.ssh/id_ed25519 \
  && chmod 600 /root/.ssh/id_ed25519
