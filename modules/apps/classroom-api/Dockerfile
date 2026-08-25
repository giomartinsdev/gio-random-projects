# Multi-stage: install/build with full npm, ship only production deps
# and compiled JS -- same shape as bookclub-api's own Dockerfile. No
# drizzle/ directory to copy: this service owns no Postgres tables of
# its own (see src/lib/auth.ts's own comment).
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
USER node
EXPOSE 8000
CMD ["node", "dist/index.js"]
