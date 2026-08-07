// Typed wrapper over three bora-api endpoints, reached through the
// gateway (web -> gateway -> bora-api -> domain — see
// api/gateway/app/main.py's proxy_nearby_stops/proxy_trip_options/
// proxy_geocode and api/bora-api/app/main.py for the response shapes
// this mirrors). This app never talks to bora-api directly — the
// gateway is the only public entry point, same as every other caller
// in this system.

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:8000";

export interface NearbyStop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distance_m: number;
  walk_seconds: number;
}

export interface TripOption {
  line_id: string;
  line_code: string;
  line_name: string;
  origin_stop_id: string;
  origin_stop_name: string;
  origin_latitude: number;
  origin_longitude: number;
  destination_stop_id: string;
  destination_stop_name: string;
  destination_latitude: number;
  destination_longitude: number;
  walk_seconds: number;
  trip_seconds: number;
  vehicle_id: string | null;
  eta_seconds: number | null;
  // Populated only when this option requires a transfer — null on a
  // direct match (see bora-api's TripPlanner for why: direct lines are
  // always tried first).
  transfer_stop_id: string | null;
  transfer_stop_name: string | null;
  transfer_latitude: number | null;
  transfer_longitude: number | null;
  transfer_line_id: string | null;
  transfer_line_code: string | null;
  transfer_line_name: string | null;
  transfer_seconds: number | null;
}

export interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
}

export interface LineVehicle {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  speed_kmh: number;
}

class ApiError extends Error {
  readonly path: string;
  readonly status: number;

  constructor(path: string, status: number) {
    super(`${path} failed with ${status}`);
    this.path = path;
    this.status = status;
  }
}

async function getJson<T>(
  path: string,
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(path, GATEWAY_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new ApiError(path, response.status);
  }
  return (await response.json()) as T;
}

export function fetchNearbyStops(latitude: number, longitude: number): Promise<NearbyStop[]> {
  return getJson<NearbyStop[]>("/nearby-stops", { lat: latitude, lon: longitude });
}

export function fetchTripOptions(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
  signal?: AbortSignal,
): Promise<TripOption[]> {
  return getJson<TripOption[]>(
    "/trip-options",
    {
      from_lat: fromLatitude,
      from_lon: fromLongitude,
      to_lat: toLatitude,
      to_lon: toLongitude,
    },
    signal,
  );
}

export function searchDestination(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  return getJson<GeocodeResult[]>("/geocode", { q: query, limit: 5 }, signal);
}

export function fetchLineVehicles(
  lineCode: string,
  signal?: AbortSignal,
): Promise<LineVehicle[]> {
  return getJson<LineVehicle[]>("/line-vehicles", { line_code: lineCode }, signal);
}

export { ApiError };
