# Same multi-stage/distroless pattern as the other Go apps here. The
# React bundle is a separate app (asset-manager-frontend, its own
# origin) served elsewhere -- nothing web-related belongs in this
# image. This service has no database/volume: its only state is an
# in-memory quote cache that is fine to lose on restart.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/asset-manager-api .

# No shell, no package manager -- same reasoning as the other Go apps
# here.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/asset-manager-api /app/asset-manager-api
USER nonroot:nonroot
ENTRYPOINT ["/app/asset-manager-api"]
