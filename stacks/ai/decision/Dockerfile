# Dockerfile — servidor de decisão (System One) self-hosted, CPU.
#
# Empacota o `jev-style` (github.com/lawrence3699/jev-style), que serve o
# endpoint POST /v1/systemone com modelos de decisão pequenos e calibrados
# (Jev-Style 0.8B/2B, base Qwen3.5, Apache-2.0 — uso comercial liberado).
#
# Nada sai da rede: o modelo roda aqui (CPU) e o 9router chama via `apps`.
#
# Os pesos NÃO ficam na imagem: são baixados no primeiro boot pro volume
# JEV_STYLE_MODEL_DIR (/models) e persistem. Assim a imagem é enxuta e dá pra
# trocar o release por env sem rebuildar.
#
# O `[torch]` traz o PyTorch CPU. Em arm64 (VPS Ampere) o `--backend auto`
# escolhe torch; em Apple seria MLX (mas o container é Linux).
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models/hf \
    JEV_STYLE_RELEASE=2b \
    JEV_STYLE_BACKEND=auto \
    JEV_STYLE_PORT=8765

RUN pip install --no-cache-dir "jev-style[torch]"

RUN useradd --create-home --uid 10001 decision \
    && mkdir -p /models \
    && chown -R decision:decision /models

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER decision
WORKDIR /home/decision
EXPOSE 8765

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
