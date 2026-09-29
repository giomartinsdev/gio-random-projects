# clubs-api: the FC Clubs Hub backend. One published loopback port, one
# hostname, no database (everything goes through domain-api over the shared
# docker bridge network -- the contas-api pattern, not cch-api's
# network_mode=host loopback trick).
#
# Cross-compiled on the build platform (see domain-api/Dockerfile for the full
# reasoning): `go build` runs native on the amd64 runner and only the arm64
# result ships, instead of the whole build running under QEMU.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/app .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
USER nonroot:nonroot
ENTRYPOINT ["/app"]
