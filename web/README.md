# bora.

The rider-facing app: React + TypeScript + Vite. Talks only to
`../api/gateway` — never to bora-api or domain directly, same "one public
entry point" rule every other consumer in this system follows:

```
browser --> gateway --> bora-api --> domain
```

The gateway proxies `/nearby-stops`, `/trip-options`, and `/geocode`
straight through to bora-api without requiring the API key its other routes
need (see `api/gateway/app/main.py`'s `proxy_nearby_stops`/
`proxy_trip_options`/`proxy_geocode`) — those three are the only paths
this app ever calls.

## What it does

1. Requests the browser's geolocation as the trip's origin.
2. Free-text destination search via `GET /geocode` (→ bora-api → Nominatim,
   scoped to Rio de Janeiro), with a few quick-pick chips for common
   destinations.
3. Once both an origin and a destination exist, `GET /trip-options`
   returns direct bus lines with a live ETA when one's available —
   rendered as a list, refreshed every 20s to catch a new GPS poll
   landing (see `src/App.tsx`'s own comment on why 20s, not faster).
4. Selecting a line opens a detail view with a client-side ticking
   countdown between refreshes — never invents precision the backend
   doesn't have: no live vehicle reporting on a line shows "sem previsão
   ao vivo" instead of a fake countdown.

## Config

`VITE_GATEWAY_URL` — where the gateway lives (see `.env.example`).
Defaults to `http://localhost:8000` for local dev.

## Running locally

```bash
npm install
npm run dev
```

Needs `api/gateway` (and, transitively, `api/bora-api` + `api/domain` with
GTFS data imported) running to show real results — without it, the app
still renders every state correctly, it just never gets past the
destination search step (geocode/trip-option requests fail, caught and
shown as a retry prompt rather than crashing).

## Checks

```bash
npm run build   # tsc -b && vite build — the type-check that matters
npm run lint    # oxlint
```
