# Multi-stage: install/build with full npm, ship only production deps
# and compiled JS -- same shape as post-api's own Dockerfile.
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
