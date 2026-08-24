# Multi-stage: install/build with full npm, ship only production deps
# and compiled JS — smallest reasonable image for an i3/8GB homelab
# host, matching domain-api's build/ship split.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /src/dist ./dist
COPY --from=build /src/drizzle ./drizzle
USER node
EXPOSE 8000
CMD ["node", "dist/index.js"]
