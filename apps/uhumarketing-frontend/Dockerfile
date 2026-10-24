# Imagem da SPA do uhumarketing.
#
# Serve o build estático e faz proxy de /api, /webhooks e /healthz para a API.
# É de propósito: com SPA e API na MESMA origem, o bundle não precisa de URL
# absoluta (VITE_UHU_API_URL fica vazia), não há CORS e o callback do webhook
# que o operador cola na Meta é o mesmo endereço que ele abre no navegador.
#
#   docker build -t uhumarketing-web .
#   API_UPSTREAM=http://api:8195 docker run -p 8080:80 -e API_UPSTREAM ...

FROM node:22-alpine AS build
WORKDIR /app

# Só o manifesto primeiro: o cache de node_modules sobrevive a mudanças de src.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Vazio = mesma origem. Só preencha se a API morar em outro domínio.
ARG VITE_UHU_API_URL=""
ENV VITE_UHU_API_URL=$VITE_UHU_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# 8080 no host é só sugestão de compose; o container escuta 80.
EXPOSE 80
