# clubs-api: the FC Clubs Hub backend. One published loopback port, one
# hostname, no database (everything goes through domain-api over the shared
# docker bridge network -- the contas-api pattern, not cch-api's
# network_mode=host loopback trick).
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
USER nonroot:nonroot
ENTRYPOINT ["/app"]
