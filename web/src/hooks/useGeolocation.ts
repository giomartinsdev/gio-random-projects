import { useCallback, useState } from "react";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type GeolocationStatus = "idle" | "locating" | "ready" | "denied" | "unavailable";

export function useGeolocation() {
  const [status, setStatus] = useState<GeolocationStatus>("idle");
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setStatus("ready");
      },
      (error) => {
        setStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  return { status, coordinates, locate };
}
