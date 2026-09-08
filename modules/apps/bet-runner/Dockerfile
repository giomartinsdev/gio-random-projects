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
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN npx patchright install --with-deps chromium
COPY --from=build /src/dist ./dist
RUN mkdir -p /data && chown -R node:node /data /ms-playwright
USER node
VOLUME /data
CMD ["node", "dist/index.js"]