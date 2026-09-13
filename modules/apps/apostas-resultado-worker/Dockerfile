# Same multi-stage/distroless pattern as every other Go app here. No
# port is published -- this is a background loop, not an HTTP service.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/apostas-resultado-worker .

# No shell, no package manager -- same reasoning as the other Go apps
# here.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/apostas-resultado-worker /app/apostas-resultado-worker
USER nonroot:nonroot
ENTRYPOINT ["/app/apostas-resultado-worker"]
