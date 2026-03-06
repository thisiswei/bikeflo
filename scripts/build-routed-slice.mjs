import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_INPUT = path.join(
  repoRoot,
  "public/data/official-2026-02-27-morning.json"
);
const DEFAULT_OUTPUT = path.join(
  repoRoot,
  "public/data/official-2026-02-27-morning-routed.json"
);
const STATIONS_PATH = path.join(repoRoot, "src/data/stations.json");

const CROSSING_POINTS = {
  "brooklyn-manhattan": [
    [-73.9969, 40.7061],
    [-73.9903, 40.7075],
    [-73.9718, 40.7137]
  ],
  "manhattan-queens": [[-73.9527, 40.7568]],
  "bronx-manhattan": [
    [-73.9337, 40.8151],
    [-73.9288, 40.8107]
  ],
  "brooklyn-queens": [
    [-73.9501, 40.7447],
    [-73.9222, 40.7265]
  ]
};

function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || !process.argv[index + 1]) {
    return fallback;
  }

  return path.resolve(process.argv[index + 1]);
}

function normalizeBorough(value) {
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

function roundCoordinate(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundPoint([longitude, latitude]) {
  return [roundCoordinate(longitude), roundCoordinate(latitude)];
}

function dedupePath(points) {
  return points.filter(
    (point, index) =>
      index === 0 ||
      point[0] !== points[index - 1]?.[0] ||
      point[1] !== points[index - 1]?.[1]
  );
}

function densifySegment(start, end) {
  const deltaLng = end[0] - start[0];
  const deltaLat = end[1] - start[1];
  const largestDelta = Math.max(Math.abs(deltaLng), Math.abs(deltaLat));
  const steps = Math.max(1, Math.ceil(largestDelta / 0.0045));

  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    return roundPoint([
      start[0] + deltaLng * progress,
      start[1] + deltaLat * progress
    ]);
  });
}

function densifyPath(points) {
  return points.flatMap((point, index) => {
    if (index === 0) {
      return [roundPoint(point)];
    }

    return densifySegment(points[index - 1], point).slice(1);
  });
}

function distanceSquared([ax, ay], [bx, by]) {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function pickTurnOrder(start, end, borough) {
  if (borough === "manhattan") {
    return "vertical-first";
  }

  return Math.abs(end[1] - start[1]) >= Math.abs(end[0] - start[0])
    ? "vertical-first"
    : "horizontal-first";
}

function orthogonalPath(start, end, borough) {
  const turnOrder = pickTurnOrder(start, end, borough);

  if (turnOrder === "vertical-first") {
    return dedupePath([start, [start[0], end[1]], end]);
  }

  return dedupePath([start, [end[0], start[1]], end]);
}

function crossingKey(startBorough, endBorough) {
  const key = [startBorough, endBorough].sort().join("-");
  return key in CROSSING_POINTS ? key : null;
}

function connectorPath(start, end, connector) {
  const startApproach =
    Math.abs(start[1] - connector[1]) >= Math.abs(start[0] - connector[0])
      ? [start[0], connector[1]]
      : [connector[0], start[1]];

  const endApproach =
    Math.abs(end[1] - connector[1]) >= Math.abs(end[0] - connector[0])
      ? [connector[0], end[1]]
      : [end[0], connector[1]];

  return dedupePath([start, startApproach, connector, endApproach, end]);
}

function buildApproximatePath(start, end, startBorough, endBorough) {
  if (
    startBorough === endBorough ||
    startBorough === "unknown" ||
    endBorough === "unknown" ||
    startBorough === "other" ||
    endBorough === "other"
  ) {
    return densifyPath(orthogonalPath(start, end, startBorough));
  }

  const key = crossingKey(startBorough, endBorough);
  if (!key) {
    return densifyPath(orthogonalPath(start, end, startBorough));
  }

  const connector = CROSSING_POINTS[key].reduce((best, candidate) => {
    if (!best) {
      return candidate;
    }

    const bestScore =
      distanceSquared(start, best) + distanceSquared(best, end);
    const candidateScore =
      distanceSquared(start, candidate) + distanceSquared(candidate, end);

    return candidateScore < bestScore ? candidate : best;
  }, null);

  return densifyPath(connectorPath(start, end, connector));
}

async function main() {
  const inputPath = getArg("--input", DEFAULT_INPUT);
  const outputPath = getArg("--output", DEFAULT_OUTPUT);
  const [stationsRaw, inputRaw] = await Promise.all([
    readFile(STATIONS_PATH, "utf8"),
    readFile(inputPath, "utf8")
  ]);

  const stations = JSON.parse(stationsRaw);
  const input = JSON.parse(inputRaw);
  const boroughLookup = new Map();

  for (const station of stations) {
    const borough = normalizeBorough(station.borough);
    boroughLookup.set(station.name, borough);
    for (const alias of station.aliases ?? []) {
      boroughLookup.set(alias, borough);
    }
  }

  const routedTrips = input.trips.map((trip) => {
    const startBorough = boroughLookup.get(trip.startStationName) ?? "unknown";
    const endBorough = boroughLookup.get(trip.endStationName) ?? "unknown";
    const path = buildApproximatePath(
      [trip.startLng, trip.startLat],
      [trip.endLng, trip.endLat],
      startBorough,
      endBorough
    );

    return {
      ...trip,
      startBorough,
      endBorough,
      path
    };
  });

  const payload = {
    meta: {
      ...input.meta,
      notes:
        "Generated from the official Citi Bike trip history monthly zip. Paths are inferred offline from official start and end stations with cached grid routing.",
      generatedAt: new Date().toISOString(),
      routeStrategy:
        "offline grid routing from official Citi Bike start/end stations"
    },
    trips: routedTrips
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        input: path.relative(repoRoot, inputPath),
        output: path.relative(repoRoot, outputPath),
        trips: routedTrips.length
      },
      null,
      2
    )
  );
}

await main();
