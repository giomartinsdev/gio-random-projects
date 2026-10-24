#!/bin/sh
# entrypoint.sh — baixa os pesos (uma vez, no cache do HF no volume) e sobe o
# servidor System One. Idempotente: o `download` reaproveita o cache local.
set -eu

RELEASE="${JEV_STYLE_RELEASE:-2b}"
PORT="${JEV_STYLE_PORT:-8765}"

echo "[decision] release=${RELEASE} port=${PORT} hf_home=${HF_HOME:-} backend=${JEV_STYLE_BACKEND:-auto}"

# Pré-baixa os pesos pro HF_HOME (que vive no volume /models). Se falhar (rede),
# o `serve` mais abaixo ainda tenta — e, pior caso, baixa na hora.
if [ "${JEV_STYLE_SKIP_DOWNLOAD:-0}" != "1" ]; then
  jev-style download --release "$RELEASE" \
    || echo "[decision] download falhou; o serve tentará de novo (verifique rede/HF_HOME)"
fi

# Auth por bearer opcional: só liga se JEV_STYLE_API_KEY estiver setada (vira
# variável de stack no Dockhand). Sem ela, o container confia na rede `apps`.
set -- serve --release "$RELEASE" --host 0.0.0.0 --port "$PORT"
if [ -n "${JEV_STYLE_API_KEY:-}" ]; then
  set -- "$@" --api-key-env JEV_STYLE_API_KEY
fi

exec jev-style "$@"
