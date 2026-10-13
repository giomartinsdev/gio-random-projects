# Dockerfile — Excalidraw (SPA estático) para a VPS arm64.
#
# É o Dockerfile do upstream (excalidraw/excalidraw) com UMA correção: a base
# `node:18` do tag pinado não instala mais — uma dependência transitiva
# (`marked@16.4.2`) exige node >= 20 ("The engine node is incompatible with
# this module"). O `engines` do próprio projeto é `18.0.0 - 22.x.x`, então
# `node:22` satisfaz os dois. O resto é idêntico: build do SPA (yarn) e cópia
# do build pro nginx. O workflow `excalidraw-image.yml` sobrescreve o Dockerfile
# do clone com este (mesmo padrão do maus-image.yml).
FROM node:22 AS build

WORKDIR /opt/node_app

COPY . .

# do not ignore optional dependencies:
# Error: Cannot find module @rollup/rollup-linux-x64-gnu
RUN yarn --network-timeout 600000

ARG NODE_ENV=production

RUN yarn build:app:docker

FROM nginx:1.27-alpine

COPY --from=build /opt/node_app/excalidraw-app/build /usr/share/nginx/html

HEALTHCHECK CMD wget -q -O /dev/null http://localhost || exit 1
