# Same multi-stage/distroless pattern as every other Go app here. No
# port is published -- this is a background loop, not an HTTP service.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/proventos-worker .

# No shell, no package manager -- same reasoning as the other Go apps
# here.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/proventos-worker /app/proventos-worker
USER nonroot:nonroot
ENTRYPOINT ["/app/proventos-worker"]
