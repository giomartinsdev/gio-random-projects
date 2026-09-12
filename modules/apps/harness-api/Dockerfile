# Same multi-stage/distroless pattern as the other Go apps here. The
# React bundle is a separate app (harness-frontend, its own origin)
# served from MinIO -- nothing web-related belongs in this image. The
# SQLite database lives on a docker volume mounted at /data.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/harness-api .

# No shell, no package manager -- same reasoning as the other Go apps
# here.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/harness-api /app/harness-api
USER nonroot:nonroot
ENTRYPOINT ["/app/harness-api"]