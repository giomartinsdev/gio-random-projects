import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LineVehicle } from "../api";

// Leaflet's default marker images resolve relative to the page's own
// origin, not the bundled asset path — broken under Vite the same way
// it's broken under every other bundler. Plain colored dots sidestep
// that entirely instead of wiring up the image imports.
function dotIcon(color: string, size: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid var(--bg);box-shadow:0 1px 4px rgba(0,0,0,0.4)"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const ORIGIN_ICON = dotIcon("var(--text)", 14);
const DESTINATION_ICON = dotIcon("var(--danger)", 14);
const TRANSFER_ICON = dotIcon("#e2a83e", 14);
const VEHICLE_ICON = dotIcon("var(--accent)", 18);

interface MapViewProps {
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  transferLatitude: number | null;
  transferLongitude: number | null;
  vehicles: LineVehicle[];
}

export function MapView({
  originLatitude,
  originLongitude,
  destinationLatitude,
  destinationLongitude,
  transferLatitude,
  transferLongitude,
  vehicles,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const vehicleMarkersRef = useRef<Map<string, L.Marker>>(new Map());

  // Origin/destination and the map itself are only ever set up once per
  // mounted DetailView (a rider picking a different line closes and
  // reopens this component, per App.tsx's selectedOption key) — re-init
  // on every vehicle poll would reset the user's own pan/zoom.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      attributionControl: false,
      zoomControl: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
    L.marker([originLatitude, originLongitude], { icon: ORIGIN_ICON }).addTo(map);
    L.marker([destinationLatitude, destinationLongitude], { icon: DESTINATION_ICON }).addTo(map);
    const bounds: L.LatLngTuple[] = [
      [originLatitude, originLongitude],
      [destinationLatitude, destinationLongitude],
    ];
    if (transferLatitude !== null && transferLongitude !== null) {
      L.marker([transferLatitude, transferLongitude], { icon: TRANSFER_ICON }).addTo(map);
      bounds.push([transferLatitude, transferLongitude]);
    }
    map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24] });
    mapRef.current = map;
    const vehicleMarkers = vehicleMarkersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      vehicleMarkers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above: this effect intentionally runs once per mount, not on every coordinate/vehicle change
  }, []);

  // A separate effect from setup on purpose: this one re-runs on every
  // live poll and must only move markers, never touch the map's own
  // view state (see the setup effect's own note on preserving pan/zoom).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = vehicleMarkersRef.current;
    const seenIds = new Set(vehicles.map((vehicle) => vehicle.vehicle_id));

    for (const [id, marker] of markers) {
      if (!seenIds.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    for (const vehicle of vehicles) {
      const position: L.LatLngTuple = [vehicle.latitude, vehicle.longitude];
      const existing = markers.get(vehicle.vehicle_id);
      if (existing) {
        existing.setLatLng(position);
      } else {
        markers.set(
          vehicle.vehicle_id,
          L.marker(position, { icon: VEHICLE_ICON }).addTo(map),
        );
      }
    }
  }, [vehicles]);

  return <div ref={containerRef} className="line-map" />;
}
