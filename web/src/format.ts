export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)} s`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}
