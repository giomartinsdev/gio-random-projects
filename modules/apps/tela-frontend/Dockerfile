# Static SPA build, served by nginx -- no Node runtime needed at
# runtime, smallest reasonable image. Same pattern as modules/apps/front.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_TELA_API_URL
ENV VITE_TELA_API_URL=$VITE_TELA_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
