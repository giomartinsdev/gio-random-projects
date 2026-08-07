# Multi-stage: build the static bundle, then serve it with `vite
# preview` — no extra runtime (nginx, etc.) to introduce for what's
# still a small, low-traffic app. VITE_GATEWAY_URL is a build ARG, not a
# runtime env var: Vite inlines import.meta.env.* into the bundle at
# build time (see src/api.ts), so it has to be known before `npm run
# build` runs, not after — see .github/workflows/web-build-push.yml,
# which bakes in the real https://gateway.giomartins.dev at build time.

FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_GATEWAY_URL
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# `vite preview` reads its config at startup, not just at build time —
# without this, allowedHosts (vite.config.ts) never gets applied here
# and every request with a non-localhost Host header (i.e. everything
# forwarded through the Cloudflare Tunnel) 403s. Confirmed live: dropped
# this line once, the container came up fine but rejected the real
# bora.giomartins.dev Host header on every single request.
COPY --from=build /app/vite.config.ts ./

RUN useradd --create-home appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 4173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
