# Same multi-stage/distroless pattern as the other Go apps here. The
# React bundle is a separate app (its own origin) served from MinIO --
# nothing web-related belongs in this image. This service has no
# database of its own: no volume to mount.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/dashboard-api .

# No shell, no package manager -- same reasoning as the other Go apps
# here.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/dashboard-api /app/dashboard-api
USER nonroot:nonroot
ENTRYPOINT ["/app/dashboard-api"]
