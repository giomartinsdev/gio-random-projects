# Same multi-stage/distroless pattern as the other Go apps here. No
# database driver, no third-party deps at all (stdlib only) -- this is
# the smallest surface possible for the one public route it exposes.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/leads-api .

# No shell, no package manager -- same reasoning as the other Go apps
# here.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/leads-api /app/leads-api
USER nonroot:nonroot
ENTRYPOINT ["/app/leads-api"]
