# Multi-stage: build with the full Go toolchain, ship a static binary on
# distroless -- no shell, no package manager, smallest possible image for
# an i3/8GB homelab host. Same shape as domain-api/tela-api/clubs-api.
#
# `--platform=$BUILDPLATFORM` no estágio de build: o VPS é arm64 e o runner do
# CI é amd64, então sem isto o `go build` rodaria DENTRO de uma imagem arm64
# emulada por QEMU. Como o serviço é Go puro (CGO_ENABLED=0), o binário pode ser
# CROSS-COMPILADO: o toolchain roda nativo e só o resultado é arm64.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
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
