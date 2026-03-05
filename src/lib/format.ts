import { simulationStart, type Trip } from "../data/citybike";

export function formatSimulationTime(currentTime: number) {
  const date = new Date(simulationStart.getTime() + currentTime * 1000);

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York"
  }).format(date);
}

export function formatSimulationDate(currentTime: number) {
  const date = new Date(simulationStart.getTime() + currentTime * 1000);

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York"
  }).format(date);
}

export function formatDuration(minutes: number) {
  return `${minutes} min`;
}

export function formatMiles(distanceMeters: number) {
  return `${(distanceMeters / 1609.34).toFixed(1)} mi`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const sanitized = hex.replace("#", "");
  const value = Number.parseInt(sanitized, 16);

  return [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255
  ];
}

export function uniqueStationCount(trips: Trip[]) {
  return new Set(
    trips.flatMap((trip) => [trip.startStationName, trip.endStationName])
  ).size;
}
