# Static SPA build, served by nginx -- no Node runtime needed at
# runtime, smallest reasonable image.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_POST_API_URL
ARG VITE_BOOKCLUB_API_URL
ARG VITE_CLASSROOM_API_URL
ARG VITE_DISCORD_CLIENT_ID
ENV VITE_POST_API_URL=$VITE_POST_API_URL
ENV VITE_BOOKCLUB_API_URL=$VITE_BOOKCLUB_API_URL
ENV VITE_CLASSROOM_API_URL=$VITE_CLASSROOM_API_URL
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID
RUN npm run build

FROM nginx:alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
