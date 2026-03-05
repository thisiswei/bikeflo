import * as duckdb from "@duckdb/duckdb-wasm";
import polyline from "@mapbox/polyline";

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

export type Trip = {
  id: string;
  startStationName: string;
  endStationName: string;
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

type QueryRow = {
  id: string;
  startStationName: string;
  endStationName: string;
  startedAtMs: bigint | number;
  endedAtMs: bigint | number;
  bikeType: "classic_bike" | "electric_bike";
  memberCasual: "member" | "casual";
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  routeGeometry: string;
  routeDistance: number;
};

const PARQUET_BASE_URL = "https://cdn.bikemap.nyc";
const PARQUET_DAY = "2025-07-18";
const FILE_NAME = `${PARQUET_DAY}.parquet`;
const WINDOW_START = new Date("2025-07-18T07:00:00-04:00");
const WINDOW_END = new Date("2025-07-18T08:35:00-04:00");
const BOUNDS = {
  minLat: 40.71,
  maxLat: 40.77,
  minLng: -74.01,
  maxLng: -73.95
};
const MAX_TRIPS = 120;

export const simulationStart = WINDOW_START;
export const totalSimulationSeconds =
  (WINDOW_END.getTime() - WINDOW_START.getTime()) / 1000;

export const rideFilterMeta: Record<
  RideFilter,
  { label: string; description: string }
> = {
  all: {
    label: "All rides",
    description:
      "Real Citi Bike trips from a Friday morning slice, processed and hosted by bikemap.nyc."
  },
  classic_bike: {
    label: "Classic bikes",
    description: "Mechanical bike rides only."
  },
  electric_bike: {
    label: "E-bikes",
    description: "Electric-assist trips from the same historical window."
  },
  member: {
    label: "Members",
    description: "Rides taken by Citi Bike members."
  },
  casual: {
    label: "Casual",
    description: "Short-term rider trips from the same window."
  }
};

let dbPromise:
  | Promise<{
      db: duckdb.AsyncDuckDB;
      conn: duckdb.AsyncDuckDBConnection;
    }>
  | null = null;
let fileRegistered = false;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildTimestamps(startTime: number, endTime: number, count: number) {
  return Array.from(
    { length: count },
    (_, index) => startTime + ((endTime - startTime) * index) / (count - 1)
  );
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

async function getDatabase() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundles = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(bundles);
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], {
          type: "text/javascript"
        })
      );

      const worker = new Worker(workerUrl);
      const logger: duckdb.Logger = { log: () => {} };
      const db = new duckdb.AsyncDuckDB(logger, worker);

      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);

      await db.open({
        path: ":memory:",
        filesystem: {
          forceFullHTTPReads: false,
          allowFullHTTPReads: false,
          reliableHeadRequests: true
        }
      });

      const conn = await db.connect();
      return { db, conn };
    })();
  }

  const database = await dbPromise;

  if (!fileRegistered) {
    await database.db.registerFileURL(
      FILE_NAME,
      `${PARQUET_BASE_URL}/parquets/${FILE_NAME}`,
      duckdb.DuckDBDataProtocol.HTTP,
      false
    );
    fileRegistered = true;
  }

  return database;
}

export async function loadCitybikeSlice(): Promise<{
  trips: Trip[];
  stations: Station[];
}> {
  const { conn } = await getDatabase();

  const result = await conn.query(`
    SELECT
      id,
      startStationName,
      endStationName,
      epoch_ms(startedAt) AS startedAtMs,
      epoch_ms(endedAt) AS endedAtMs,
      bikeType,
      memberCasual,
      startLat,
      startLng,
      endLat,
      endLng,
      routeGeometry,
      routeDistance
    FROM read_parquet(['${FILE_NAME}'])
    WHERE startedAt >= epoch_ms(${WINDOW_START.getTime()})
      AND startedAt < epoch_ms(${WINDOW_END.getTime()})
      AND routeGeometry IS NOT NULL
      AND routeDistance IS NOT NULL
      AND epoch_ms(endedAt) - epoch_ms(startedAt) BETWEEN 2 * 60 * 1000 AND 90 * 60 * 1000
      AND startLat BETWEEN ${BOUNDS.minLat} AND ${BOUNDS.maxLat}
      AND endLat BETWEEN ${BOUNDS.minLat} AND ${BOUNDS.maxLat}
      AND startLng BETWEEN ${BOUNDS.minLng} AND ${BOUNDS.maxLng}
      AND endLng BETWEEN ${BOUNDS.minLng} AND ${BOUNDS.maxLng}
      AND routeDistance BETWEEN 250 AND 12000
    ORDER BY startedAt ASC
    LIMIT ${MAX_TRIPS}
  `);

  const stationMap = new Map<string, Station>();

  const trips = (result.toArray() as QueryRow[])
    .map((row) => {
      const startedAt = new Date(Number(row.startedAtMs));
      const endedAt = new Date(Number(row.endedAtMs));
      const decoded = polyline.decode(row.routeGeometry, 6);
      const path = decoded.map(
        ([latitude, longitude]) => [longitude, latitude] as [number, number]
      );

      if (path.length < 2) {
        return null;
      }

      const startTime = (startedAt.getTime() - WINDOW_START.getTime()) / 1000;
      const endTime = (endedAt.getTime() - WINDOW_START.getTime()) / 1000;

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

      return {
        id: row.id,
        startStationName: row.startStationName,
        endStationName: row.endStationName,
        startCoordinates: [row.startLng, row.startLat],
        endCoordinates: [row.endLng, row.endLat],
        startedAt,
        endedAt,
        bikeType: row.bikeType,
        memberCasual: row.memberCasual,
        routeDistance: row.routeDistance,
        path,
        timestamps: buildTimestamps(startTime, endTime, path.length),
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
