import type { BoroughFilter, RideFilter, Trip } from "../data/citybike";

export const MAX_RENDERED_TRIPS = 32;

export type FocusStation = {
  name: string;
  coordinates: [number, number];
};

export function matchesRideFilter(trip: Trip, rideFilter: RideFilter) {
  return (
    rideFilter === "all" ||
    trip.bikeType === rideFilter ||
    trip.memberCasual === rideFilter
  );
}

export function matchesBoroughFilter(
  trip: Trip,
  boroughFilter: BoroughFilter
) {
  return (
    boroughFilter === "all" ||
    trip.startBorough === boroughFilter ||
    trip.endBorough === boroughFilter
  );
}

export function getTripPosition(
  trip: Trip,
  currentTime: number
): [number, number] | null {
  if (currentTime < trip.startTime || currentTime > trip.endTime) {
    return null;
  }

  const { timestamps, path } = trip;

  if (timestamps.length < 2 || path.length < 2) {
    return path[0] ?? null;
  }

  for (let index = 1; index < timestamps.length; index += 1) {
    const previousTime = timestamps[index - 1];
    const nextTime = timestamps[index];

    if (currentTime <= nextTime) {
      const [startLng, startLat] = path[index - 1]!;
      const [endLng, endLat] = path[index]!;
      const span = nextTime - previousTime || 1;
      const progress = Math.min(
        1,
        Math.max(0, (currentTime - previousTime) / span)
      );

      return [
        startLng + (endLng - startLng) * progress,
        startLat + (endLat - startLat) * progress
      ];
    }
  }

  return path[path.length - 1] ?? null;
}

function countUniqueStations(trips: Trip[]) {
  return new Set(
    trips.flatMap((trip) => [trip.startStationName, trip.endStationName])
  ).size;
}

export function derivePlaybackState({
  trips,
  rideFilter,
  boroughFilter,
  currentTime,
  hoveredTrip,
  pinnedTripId
}: {
  trips: Trip[];
  rideFilter: RideFilter;
  boroughFilter: BoroughFilter;
  currentTime: number;
  hoveredTrip: Trip | null;
  pinnedTripId: string | null;
}) {
  const visibleTrips = trips.filter(
    (trip) =>
      matchesRideFilter(trip, rideFilter) &&
      matchesBoroughFilter(trip, boroughFilter)
  );
  const activeTrips = visibleTrips.filter(
    (trip) => currentTime >= trip.startTime && currentTime <= trip.endTime
  );
  const activeStations = countUniqueStations(activeTrips);
  const pinnedTrip = pinnedTripId
    ? visibleTrips.find((trip) => trip.id === pinnedTripId) ?? null
    : null;
  const hoveredVisibleTrip =
    hoveredTrip && visibleTrips.some((trip) => trip.id === hoveredTrip.id)
      ? hoveredTrip
      : null;
  const highlightedTrip = pinnedTrip ?? hoveredVisibleTrip ?? null;
  const hasExplicitFocus = Boolean(pinnedTrip || hoveredVisibleTrip);
  const renderedTrips =
    activeTrips.length > MAX_RENDERED_TRIPS
      ? activeTrips.slice(activeTrips.length - MAX_RENDERED_TRIPS)
      : activeTrips;
  const focusStations: FocusStation[] = highlightedTrip
    ? [
        {
          name: highlightedTrip.startStationName,
          coordinates: highlightedTrip.startCoordinates
        },
        {
          name: highlightedTrip.endStationName,
          coordinates: highlightedTrip.endCoordinates
        }
      ]
    : [];
  const labeledFocusStations = hasExplicitFocus ? focusStations : [];

  return {
    visibleTrips,
    activeTrips,
    activeStations,
    pinnedTrip,
    hoveredVisibleTrip,
    highlightedTrip,
    hasExplicitFocus,
    renderedTrips,
    focusStations,
    labeledFocusStations
  };
}
