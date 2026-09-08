# The runner is NOT multi-stage-shipped the way post-api is: the
# chromium browser patchright downloads is runtime state (~300MB), so
# the runtime stage keeps node + browser + a small compiled bundle.
# bookworm (not alpine): patchright's --with-deps installs chromium's
# system libraries via apt, which alpine's musl world doesn't provide.
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# Browsers go to a fixed path so the persistent profiles in /data stay
# the only mutable state; --with-deps apt-installs chromium's runtime
# libraries (needs root, hence BEFORE the USER line below).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# xvfb: the bookmakers' anti-fraud walls out HEADLESS chromium even
# patched (Betano answers every headless visit with its compliance
# block page; a headed browser on the same IP sails through) -- so the
# container always runs headed against a virtual display (HEADED=1 in
# the env), and xvfb-run provides that display. --with-deps stays one
# root step before the USER line.
RUN apt-get update && apt-get install -y --no-install-recommends xvfb && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN npx patchright install --with-deps chromium
COPY --from=build /src/dist ./dist
RUN mkdir -p /data && chown -R node:node /data /ms-playwright
USER node
VOLUME /data
# --auto-servernum: parallel-ish restarts shouldn't fight over :99.
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1920x1080x24", "node", "dist/index.js"]