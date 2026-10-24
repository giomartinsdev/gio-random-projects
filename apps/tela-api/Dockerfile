# Just the Go binary now -- the React bundle is a separate app
# (tela-frontend, its own container/origin) since this API split from
# it. Same multi-stage/distroless pattern as the other Go apps here.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/tela-api .

# No shell, no package manager -- same reasoning as the other Go apps
# here.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/tela-api /app/tela-api
USER nonroot:nonroot
ENTRYPOINT ["/app/tela-api"]
