# build
FROM golang:1.25-alpine AS build
WORKDIR /src

# Só o go.mod/go.sum primeiro: o cache de módulos sobrevive a mudanças de código.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# CGO desligado: o binário precisa rodar em alpine sem libc extra.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/uhumarketing-api .

# runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 uhu
WORKDIR /app

# O schema.sql vai embutido no binário (go:embed em internal/store), então a
# imagem não carrega arquivo solto: o serviço aplica o DDL na subida e um
# `docker compose up` funciona sem passo de migração.
COPY --from=build /out/uhumarketing-api ./

USER uhu
EXPOSE 8195

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8195/healthz || exit 1

ENTRYPOINT ["./uhumarketing-api"]
