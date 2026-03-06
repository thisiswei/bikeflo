import { describe, expect, it } from "vitest";
import type { Trip } from "../data/citybike";
import {
  derivePlaybackState,
  getTripPosition,
  matchesBoroughFilter,
  matchesRideFilter,
  MAX_RENDERED_TRIPS
} from "./playback";

function makeTrip(
  id: string,
  overrides: Partial<Trip> = {}
): Trip {
  return {
    id,
    startStationName: `Start ${id}`,
    endStationName: `End ${id}`,
    startBorough: "manhattan",
    endBorough: "manhattan",
    startCoordinates: [-73.99, 40.75],
    endCoordinates: [-73.98, 40.74],
    startedAt: new Date("2026-02-27T07:00:00-05:00"),
    endedAt: new Date("2026-02-27T07:20:00-05:00"),
    bikeType: "classic_bike",
    memberCasual: "member",
    routeDistance: 1000,
    path: [
      [-73.99, 40.75],
      [-73.99, 40.74],
      [-73.98, 40.74]
    ],
    timestamps: [0, 30, 60],
    startTime: 0,
    endTime: 60,
    accent: "#ffffff",
    riderLabel: "Member",
    durationMinute: 20,
    ...overrides
  };
}

describe("playback helpers", () => {
  it("matches ride filters for bike type and rider type", () => {
    const classicMember = makeTrip("classic");
    const ebikeCasual = makeTrip("ebike", {
      bikeType: "electric_bike",
      memberCasual: "casual"
    });

    expect(matchesRideFilter(classicMember, "all")).toBe(true);
    expect(matchesRideFilter(classicMember, "classic_bike")).toBe(true);
    expect(matchesRideFilter(classicMember, "member")).toBe(true);
    expect(matchesRideFilter(classicMember, "electric_bike")).toBe(false);
    expect(matchesRideFilter(ebikeCasual, "electric_bike")).toBe(true);
    expect(matchesRideFilter(ebikeCasual, "casual")).toBe(true);
  });

  it("matches borough filters on either trip endpoint", () => {
    const crossBoroughTrip = makeTrip("cross", {
      startBorough: "brooklyn",
      endBorough: "queens"
    });

    expect(matchesBoroughFilter(crossBoroughTrip, "all")).toBe(true);
    expect(matchesBoroughFilter(crossBoroughTrip, "brooklyn")).toBe(true);
    expect(matchesBoroughFilter(crossBoroughTrip, "queens")).toBe(true);
    expect(matchesBoroughFilter(crossBoroughTrip, "manhattan")).toBe(false);
  });

  it("interpolates the trip position across route timestamps", () => {
    const trip = makeTrip("position");
    const firstSegmentPosition = getTripPosition(trip, 15);
    const secondSegmentPosition = getTripPosition(trip, 45);

    expect(getTripPosition(trip, -1)).toBeNull();
    expect(firstSegmentPosition?.[0]).toBeCloseTo(-73.99);
    expect(firstSegmentPosition?.[1]).toBeCloseTo(40.745);
    expect(secondSegmentPosition?.[0]).toBeCloseTo(-73.985);
    expect(secondSegmentPosition?.[1]).toBeCloseTo(40.74);
    expect(getTripPosition(trip, 61)).toBeNull();
  });

  it("derives filtered, focused, and rendered trips from current playback state", () => {
    const trips = Array.from({ length: 40 }, (_, index) =>
      makeTrip(`trip-${index}`, {
        startStationName: `Start ${index}`,
        endStationName: `End ${index}`,
        startCoordinates: [-73.99 + index * 0.001, 40.75],
        endCoordinates: [-73.98 + index * 0.001, 40.74],
        startBorough: index % 2 === 0 ? "manhattan" : "brooklyn",
        endBorough: "manhattan",
        bikeType: index % 3 === 0 ? "electric_bike" : "classic_bike"
      })
    );
    const hoveredTrip = trips[5]!;
    const pinnedTrip = trips[39]!;

    const state = derivePlaybackState({
      trips,
      rideFilter: "all",
      boroughFilter: "all",
      currentTime: 10,
      hoveredTrip,
      pinnedTripId: pinnedTrip.id
    });

    expect(state.visibleTrips).toHaveLength(40);
    expect(state.activeTrips).toHaveLength(40);
    expect(state.activeStations).toBe(80);
    expect(state.pinnedTrip?.id).toBe(pinnedTrip.id);
    expect(state.highlightedTrip?.id).toBe(pinnedTrip.id);
    expect(state.hasExplicitFocus).toBe(true);
    expect(state.renderedTrips).toHaveLength(MAX_RENDERED_TRIPS);
    expect(state.renderedTrips[0]?.id).toBe("trip-8");
    expect(state.renderedTrips.at(-1)?.id).toBe("trip-39");
    expect(state.focusStations).toHaveLength(2);
    expect(state.labeledFocusStations).toHaveLength(2);
  });

  it("drops hidden hovered and pinned trips when filters exclude them", () => {
    const brooklynTrip = makeTrip("brooklyn", {
      startBorough: "brooklyn",
      endBorough: "brooklyn"
    });
    const manhattanTrip = makeTrip("manhattan", {
      startBorough: "manhattan",
      endBorough: "manhattan"
    });

    const state = derivePlaybackState({
      trips: [brooklynTrip, manhattanTrip],
      rideFilter: "all",
      boroughFilter: "manhattan",
      currentTime: 10,
      hoveredTrip: brooklynTrip,
      pinnedTripId: brooklynTrip.id
    });

    expect(state.visibleTrips).toEqual([manhattanTrip]);
    expect(state.hoveredVisibleTrip).toBeNull();
    expect(state.pinnedTrip).toBeNull();
    expect(state.highlightedTrip).toBeNull();
    expect(state.labeledFocusStations).toEqual([]);
  });
});
