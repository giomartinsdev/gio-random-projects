# Multi-stage: build with the full Go toolchain, ship a static binary on
# distroless — no shell, no package manager, smallest possible image for
# an i3/8GB homelab host.
#
# `--platform=$BUILDPLATFORM` no estágio de build é o que torna isto rápido: o
# VPS é arm64 e o runner do CI é amd64, então sem isto o `go build` rodaria
# DENTRO de uma imagem arm64 emulada por QEMU -- ~2 min por app. Como o serviço
# é Go puro (CGO_ENABLED=0), o binário pode ser CROSS-COMPILADO: o toolchain
# roda nativo (amd64) e só o resultado é arm64. O estágio final continua no alvo
# (distroless é multi-arch, então nem ele precisa de emulação para copiar).
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
# Os mounts de cache guardam o módulo e o cache de compilação entre builds --
# o download de dependências é o passo mais lento de um build frio e não muda
# entre dois pushes que não tocam go.mod.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/api .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER nonroot:nonroot
ENTRYPOINT ["/api"]
