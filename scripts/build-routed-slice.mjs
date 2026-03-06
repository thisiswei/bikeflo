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
const DEFAULT_OSRM_URL = "http://127.0.0.1:5000";
const DEFAULT_CONCURRENCY = 48;

function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || !process.argv[index + 1]) {
    return fallback;
  }

  return process.argv[index + 1];
}

function getPathArg(flag, fallback) {
  const value = getArg(flag, fallback);
  return path.resolve(value);
}

function getIntArg(flag, fallback) {
  const value = Number.parseInt(getArg(flag, String(fallback)), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

function pairKey(startStationName, endStationName) {
  return `${startStationName}|||${endStationName}`;
}

async function checkOsrm(osrmUrl) {
  const response = await fetch(
    `${osrmUrl}/route/v1/bicycle/-73.99,40.73;-73.98,40.74?overview=false`
  );

  if (!response.ok) {
    throw new Error(`OSRM check failed with status ${response.status}`);
  }

  const data = await response.json();
  if (data.code !== "Ok") {
    throw new Error(`OSRM check failed with code ${data.code}`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadExistingRouteCache(outputPath) {
  try {
    const existing = await readJson(outputPath);
    const cache = new Map();

    for (const trip of existing.trips ?? []) {
      if (!trip.routeGeometry) {
        continue;
      }

      cache.set(pairKey(trip.startStationName, trip.endStationName), {
        geometry: trip.routeGeometry,
        distance: trip.routeDistance
      });
    }

    return cache;
  } catch {
    return new Map();
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );

  return results;
}

async function fetchRoute(pair, osrmUrl) {
  const url =
    `${osrmUrl}/route/v1/bicycle/` +
    `${pair.startLng},${pair.startLat};${pair.endLng},${pair.endLat}` +
    "?geometries=polyline6&overview=full";

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.code !== "Ok" || !data.routes?.[0]?.geometry) {
      return null;
    }

    return {
      geometry: data.routes[0].geometry,
      distance: data.routes[0].distance
    };
  } catch {
    return null;
  }
}

async function main() {
  const inputPath = getPathArg("--input", DEFAULT_INPUT);
  const outputPath = getPathArg("--output", DEFAULT_OUTPUT);
  const osrmUrl = getArg("--osrm-url", DEFAULT_OSRM_URL);
  const concurrency = getIntArg("--concurrency", DEFAULT_CONCURRENCY);

  const [stations, input, existingRoutes] = await Promise.all([
    readJson(STATIONS_PATH),
    readJson(inputPath),
    loadExistingRouteCache(outputPath)
  ]);

  const boroughLookup = new Map();
  for (const station of stations) {
    const borough = normalizeBorough(station.borough);
    boroughLookup.set(station.name, borough);
    for (const alias of station.aliases ?? []) {
      boroughLookup.set(alias, borough);
    }
  }

  const uniquePairs = [];
  const uniquePairKeys = new Set();

  for (const trip of input.trips) {
    const key = pairKey(trip.startStationName, trip.endStationName);
    if (uniquePairKeys.has(key)) {
      continue;
    }

    uniquePairKeys.add(key);
    uniquePairs.push({
      key,
      startStationName: trip.startStationName,
      endStationName: trip.endStationName,
      startLat: trip.startLat,
      startLng: trip.startLng,
      endLat: trip.endLat,
      endLng: trip.endLng
    });
  }

  await checkOsrm(osrmUrl);

  let fetchedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;

  const fetchedRoutes = await runPool(uniquePairs, concurrency, async (pair, index) => {
    const cachedRoute = existingRoutes.get(pair.key);
    if (cachedRoute) {
      cachedCount += 1;
      if ((index + 1) % 500 === 0) {
        console.log(`Reused ${index + 1}/${uniquePairs.length} station pairs...`);
      }
      return [pair.key, cachedRoute];
    }

    const route = await fetchRoute(pair, osrmUrl);
    if (!route) {
      failedCount += 1;
    } else {
      fetchedCount += 1;
    }

    if ((index + 1) % 250 === 0 || index === uniquePairs.length - 1) {
      console.log(`Routed ${index + 1}/${uniquePairs.length} station pairs...`);
    }

    return [pair.key, route];
  });

  const routeMap = new Map(
    fetchedRoutes.filter((entry) => entry[1]).map(([key, value]) => [key, value])
  );

  const routedTrips = input.trips.map((trip) => {
    const key = pairKey(trip.startStationName, trip.endStationName);
    const route = routeMap.get(key);

    return {
      ...trip,
      startBorough: boroughLookup.get(trip.startStationName) ?? "unknown",
      endBorough: boroughLookup.get(trip.endStationName) ?? "unknown",
      routeDistance: route?.distance ?? trip.routeDistance,
      routeGeometry: route?.geometry
    };
  });

  const payload = {
    meta: {
      ...input.meta,
      notes:
        "Generated from the official Citi Bike trip history monthly zip. Routes are precomputed offline with OSRM bicycle routing and cached into the shipped data asset.",
      generatedAt: new Date().toISOString(),
      routeStrategy:
        "osrm bicycle routing over NewYork.osm.pbf with polyline6 geometry"
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
        trips: routedTrips.length,
        uniquePairs: uniquePairs.length,
        cachedPairs: cachedCount,
        fetchedPairs: fetchedCount,
        failedPairs: failedCount
      },
      null,
      2
    )
  );
}

await main();
