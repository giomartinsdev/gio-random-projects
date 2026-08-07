# bora-api

The trip-planning service behind the "bora." frontend — an **internal**
service, never exposed on its own. Python 3.14, FastAPI, httpx. This is
the one place in the whole system that answers "which bus should I
catch, from where, and roughly when does it arrive" — `domain` stays
pure CRUD (Stop/Line/RouteStop/VehiclePosition) and `gateway` stays a
proxy; all the actual trip-planning logic lives here instead.

```
browser --(no key)--> gateway --(no key)--> bora-api --X-API-Key--> gateway --> domain --> db
                                                |
                                                +--> Nominatim (OpenStreetMap geocoding)
```

Note the gateway appears twice: once as the public entry point the
browser calls (see `../gateway/README.md`'s `proxy_nearby_stops`/
`proxy_trip_options`/`proxy_geocode`), and once again as bora-api's own
way of reaching `domain` — bora-api has no more direct access to
`domain` than the browser does. No auth, rate-limit, or CORS live here;
they're the gateway's job (see `app/config.py`'s own docstring).

## Endpoints

- `GET /nearby-stops?lat&lon&radius_m&limit` — stops near a point,
  sorted closest-first, each with walk distance/time.
- `GET /trip-options?from_lat&from_lon&to_lat&to_lon&radius_m&stop_limit`
  — direct bus lines connecting the two points, one option per line
  (closest boarding stop), with a live ETA when a vehicle is currently
  reporting on that line.
- `GET /geocode?q&limit` — free-text destination search, scoped to Rio
  de Janeiro, via OpenStreetMap's Nominatim.
- `GET /health` — for container healthchecks.

No auth, rate-limit, or CORS on any of these — the gateway already
handled all three before a request ever reaches this service (see
`../gateway/README.md`).

## The trip-planning logic (`app/trip_planner.py`)

v1 is deliberately simple, and says so out loud rather than hiding it:

- **Direct lines only** — no transfers. A destination with no direct
  line comes back as an empty list, not an error.
- **ETA** is straight-line distance from the closest same-line vehicle
  to the stop, divided by that vehicle's own current speed (floored) —
  not real map-matching against the line's actual shape. Good enough
  for "is a bus coming soon," not a promise of an exact arrival time.
- **Trip duration** is straight-line origin-to-destination distance
  divided by an assumed average city-bus speed, not the route's actual
  shape or GTFS scheduled times.

`app/cache.py` holds Stop/Line/RouteStop in memory on a TTL (they only
change when `flows/gtfs_importer` reimports, monthly) — live vehicle
positions are always fetched fresh per request.

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `BORA_API_GATEWAY_URL` | `http://gateway:8000` | Where domain-event reads go |
| `BORA_API_GATEWAY_API_KEY` | `""` | The API key this service authenticates to the gateway with |
| `BORA_API_REFERENCE_DATA_TTL_SECONDS` | `600.0` | How long Stop/Line/RouteStop stay cached before refreshing |
| `BORA_API_DEFAULT_RADIUS_M` | `800.0` | Default nearby-stop search radius |
| `BORA_API_DEFAULT_STOP_LIMIT` | `5` | Default max candidate stops per search |
| `BORA_API_WALKING_SPEED_MPS` | `1.3` | Assumed walking pace for walk-time estimates |
| `BORA_API_MIN_BUS_SPEED_KMH` | `5.0` | Floor applied to a vehicle's own speed before computing ETA |
| `BORA_API_AVERAGE_BUS_SPEED_KMH` | `18.0` | Assumed average speed for the trip-duration estimate |

## Telemetry

Automatic, zero-code — see `../README.md#telemetry` for how it works
(same mechanism across every service under `api/`).

## Running locally

```bash
pip install -r requirements-dev.txt
BORA_API_GATEWAY_URL=http://localhost:8000 BORA_API_GATEWAY_API_KEY=dev-key uvicorn app.main:app --reload
```

## Checks

```bash
ruff check .
ruff format --check .
pyright .
pytest
```

Every dependency this service talks to (the gateway, Nominatim) is
faked via `httpx.MockTransport` in tests — no real network call, no
testcontainers needed here (unlike `domain`/`gateway`, this service has
no database of its own).
