# Same multi-stage/distroless pattern as the other Go apps here. No
# database driver -- everything durable goes through domain-api over
# HTTP -- so the image needs nothing but the static binary.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/contas-api .

# No shell, no package manager -- same reasoning as the other Go apps
# here.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/contas-api /app/contas-api
USER nonroot:nonroot
ENTRYPOINT ["/app/contas-api"]
