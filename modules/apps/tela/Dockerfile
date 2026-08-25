# Three stages: build the React bundle, build the Go binary, ship both
# on distroless. The client is built here rather than committed, so
# `web/` is a build artefact and stays out of git.
FROM node:22-alpine AS client
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
# vite.config.ts writes to ../web -- i.e. /src/web.
RUN npm run build

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/tela .

# No shell, no package manager -- same reasoning as the other Go apps
# here. The static bundle rides along next to the binary; WEB_DIR
# points at it (see main.go).
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/tela /app/tela
COPY --from=client /src/web /app/web
USER nonroot:nonroot
ENV WEB_DIR=/app/web
ENTRYPOINT ["/app/tela"]
