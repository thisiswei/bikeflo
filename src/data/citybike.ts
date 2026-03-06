import stationsMeta from "./stations.json";
import { decodePolyline } from "../lib/polyline";
import {
  buildDistanceTimestamps,
  densifyPath
} from "../lib/route-geometry";

export type Station = {
  id: string;
  name: string;
  coordinates: [number, number];
  tripCount: number;
  featured?: boolean;
};

export type RideFilter =
  | "all"
  | "classic_bike"
  | "electric_bike"
  | "member"
  | "casual";

export type BoroughFilter =
  | "all"
  | "manhattan"
  | "brooklyn"
  | "queens"
  | "bronx";

type BoroughKey = Exclude<BoroughFilter, "all"> | "other" | "unknown";

export type Trip = {
  id: string;
  startStationName: string;
  endStationName: string;
  startBorough: BoroughKey;
  endBorough: BoroughKey;
  startCoordinates: [number, number];
  endCoordinates: [number, number];
  startedAt: Date;
  endedAt: Date;
  bikeType: "classic_bike" | "electric_bike";
  memberCasual: "member" | "casual";
  routeDistance: number;
  path: [number, number][];
  timestamps: number[];
  startTime: number;
  endTime: number;
  accent: string;
  riderLabel: string;
  durationMinute: number;
};

type StationMeta = {
  name: string;
  aliases?: string[];
  borough?: string;
};

type OfficialTripRow = {
  id: string;
  startStationName: string;
  endStationName: string;
  startedAt: string;
  endedAt: string;
  bikeType: "classic_bike" | "electric_bike";
  memberCasual: "member" | "casual";
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  routeDistance: number;
  startBorough?: BoroughKey;
  endBorough?: BoroughKey;
  path?: Coordinate[];
  routeGeometry?: string;
};

type OfficialSlicePayload = {
  meta: {
    source: string;
    sourceUrl: string;
    day: string;
    windowStart: string;
    windowEnd: string;
    initialFocusTime: string;
    count: number;
    notes: string;
    generatedAt?: string;
    routeStrategy?: string;
  };
  trips: OfficialTripRow[];
};

type Coordinate = [number, number];

const OFFICIAL_SOURCE_URL =
  "https://s3.amazonaws.com/tripdata/202602-citibike-tripdata.zip";
const OFFICIAL_SLICE_PATH = `${import.meta.env.BASE_URL}data/official-2026-02-27-morning-routed.json`;
const WINDOW_START = new Date("2026-02-27T06:00:00-05:00");
const WINDOW_END = new Date("2026-02-27T10:30:00-05:00");
const INITIAL_FOCUS_TIME = new Date("2026-02-27T07:30:00-05:00");

const boroughMeta: Record<
  BoroughFilter,
  { label: string; description: string }
> = {
  all: {
    label: "All boroughs",
    description: "Trips touching any borough in the loaded city slice."
  },
  manhattan: {
    label: "Manhattan",
    description: "Trips starting or ending in Manhattan."
  },
  brooklyn: {
    label: "Brooklyn",
    description: "Trips starting or ending in Brooklyn."
  },
  queens: {
    label: "Queens",
    description: "Trips starting or ending in Queens."
  },
  bronx: {
    label: "Bronx",
    description: "Trips starting or ending in the Bronx."
  }
};

export const simulationStart = WINDOW_START;
export const totalSimulationSeconds =
  (WINDOW_END.getTime() - WINDOW_START.getTime()) / 1000;
export const initialSimulationSeconds =
  (INITIAL_FOCUS_TIME.getTime() - WINDOW_START.getTime()) / 1000;
export { boroughMeta };

export const rideFilterMeta: Record<
  RideFilter,
  { label: string; description: string }
> = {
  all: {
    label: "All rides",
    description: "Historical Citi Bike trips from the official February 2026 trip history."
  },
  classic_bike: {
    label: "Classic bikes",
    description: "Mechanical bike rides only."
  },
  electric_bike: {
    label: "E-bikes",
    description: "Electric-assist trips from the same official historical window."
  },
  member: {
    label: "Members",
    description: "Rides taken by Citi Bike members."
  },
  casual: {
    label: "Casual",
    description: "Short-term rider trips from the same official window."
  }
};

let slicePromise: Promise<OfficialSlicePayload> | null = null;

const BOROUGH_LOOKUP = new Map<string, BoroughKey>();

for (const station of stationsMeta as StationMeta[]) {
  const borough = normalizeBorough(station.borough);

  BOROUGH_LOOKUP.set(station.name, borough);
  for (const alias of station.aliases ?? []) {
    BOROUGH_LOOKUP.set(alias, borough);
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBorough(value?: string): BoroughKey {
  switch (value) {
    case "Manhattan":
      return "manhattan";
    case "Brooklyn":
      return "brooklyn";
    case "Queens":
      return "queens";
    case "Bronx":
      return "bronx";
    case "New Jersey":
      return "other";
    default:
      return "unknown";
  }
}

function pickAccent(
  bikeType: Trip["bikeType"],
  memberCasual: Trip["memberCasual"]
) {
  if (bikeType === "electric_bike") {
    return "#72ddf7";
  }

  return memberCasual === "casual" ? "#ff8a5b" : "#c19bf5";
}

function parseOfficialEasternTime(value: string) {
  return new Date(
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}-05:00`
  );
}

async function getOfficialSlice() {
  if (!slicePromise) {
    slicePromise = fetch(OFFICIAL_SLICE_PATH).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `Failed to load official Citi Bike slice from ${OFFICIAL_SOURCE_URL}.`
        );
      }

      return (await response.json()) as OfficialSlicePayload;
    });
  }

  return slicePromise;
}

export async function loadCitybikeSlice(): Promise<{
  trips: Trip[];
  stations: Station[];
}> {
  const payload = await getOfficialSlice();
  const stationMap = new Map<string, Station>();

  const trips = payload.trips
    .map((row) => {
      const startedAt = parseOfficialEasternTime(row.startedAt);
      const endedAt = parseOfficialEasternTime(row.endedAt);
      const startTime = (startedAt.getTime() - WINDOW_START.getTime()) / 1000;
      const endTime = (endedAt.getTime() - WINDOW_START.getTime()) / 1000;
      const startBorough =
        row.startBorough ??
        (BOROUGH_LOOKUP.get(row.startStationName) ?? "unknown");
      const endBorough =
        row.endBorough ??
        (BOROUGH_LOOKUP.get(row.endStationName) ?? "unknown");

      if (endTime <= 0 || startTime >= totalSimulationSeconds) {
        return null;
      }

      const startStationId = slugify(row.startStationName);
      const endStationId = slugify(row.endStationName);

      const startStation = stationMap.get(startStationId);
      if (startStation) {
        startStation.tripCount += 1;
      } else {
        stationMap.set(startStationId, {
          id: startStationId,
          name: row.startStationName,
          coordinates: [row.startLng, row.startLat],
          tripCount: 1
        });
      }

      const endStation = stationMap.get(endStationId);
      if (endStation) {
        endStation.tripCount += 1;
      } else {
        stationMap.set(endStationId, {
          id: endStationId,
          name: row.endStationName,
          coordinates: [row.endLng, row.endLat],
          tripCount: 1
        });
      }

      const durationMinute = Math.max(
        1,
        Math.round((endedAt.getTime() - startedAt.getTime()) / 60000)
      );
      const path =
        row.routeGeometry
          ? densifyPath(decodePolyline(row.routeGeometry, 6) as Coordinate[])
          : row.path && row.path.length > 1
            ? densifyPath(row.path)
            : ([
                [row.startLng, row.startLat],
                [row.endLng, row.endLat]
              ] satisfies Coordinate[]);

      return {
        id: row.id,
        startStationName: row.startStationName,
        endStationName: row.endStationName,
        startBorough,
        endBorough,
        startCoordinates: [row.startLng, row.startLat],
        endCoordinates: [row.endLng, row.endLat],
        startedAt,
        endedAt,
        bikeType: row.bikeType,
        memberCasual: row.memberCasual,
        routeDistance: row.routeDistance,
        path,
        timestamps: buildDistanceTimestamps(path, startTime, endTime),
        startTime,
        endTime,
        accent: pickAccent(row.bikeType, row.memberCasual),
        riderLabel: row.memberCasual === "member" ? "Member" : "Casual",
        durationMinute
      } satisfies Trip;
    })
    .filter((trip): trip is Trip => trip !== null);

  const stations = Array.from(stationMap.values())
    .sort((left, right) => right.tripCount - left.tripCount)
    .map((station, index) => ({
      ...station,
      featured: index < 8
    }));

  return { trips, stations };
}
