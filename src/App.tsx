import { useEffect, useRef, useState } from "react";
import { DeckGL } from "@deck.gl/react";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type { PickingInfo } from "@deck.gl/core";
import Map from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import {
  boroughMeta,
  loadCitybikeSlice,
  rideFilterMeta,
  totalSimulationSeconds,
  type BoroughFilter,
  type RideFilter,
  type Trip
} from "./data/citybike";
import {
  formatDuration,
  formatMiles,
  formatSimulationDate,
  formatSimulationTime,
  hexToRgb,
  uniqueStationCount
} from "./lib/format";

const INITIAL_VIEW_STATE = {
  longitude: -73.968,
  latitude: 40.726,
  zoom: 11.15,
  pitch: 14,
  bearing: -6
};

const BOROUGH_VIEW_STATE: Record<BoroughFilter, typeof INITIAL_VIEW_STATE> = {
  all: INITIAL_VIEW_STATE,
  manhattan: {
    longitude: -73.985,
    latitude: 40.741,
    zoom: 12.15,
    pitch: 16,
    bearing: -8
  },
  brooklyn: {
    longitude: -73.968,
    latitude: 40.685,
    zoom: 11.35,
    pitch: 14,
    bearing: -6
  },
  queens: {
    longitude: -73.915,
    latitude: 40.744,
    zoom: 11.35,
    pitch: 14,
    bearing: -8
  },
  bronx: {
    longitude: -73.918,
    latitude: 40.81,
    zoom: 11.3,
    pitch: 14,
    bearing: -4
  }
};

const SPEED_OPTIONS = [
  { label: "20x", value: 20 },
  { label: "40x", value: 40 },
  { label: "80x", value: 80 }
] as const;

const FILTER_OPTIONS = Object.keys(rideFilterMeta) as RideFilter[];
const BOROUGH_OPTIONS = Object.keys(boroughMeta) as BoroughFilter[];

function matchesFilter(trip: Trip, rideFilter: RideFilter) {
  return (
    rideFilter === "all" ||
    trip.bikeType === rideFilter ||
    trip.memberCasual === rideFilter
  );
}

function matchesBoroughFilter(trip: Trip, boroughFilter: BoroughFilter) {
  return (
    boroughFilter === "all" ||
    trip.startBorough === boroughFilter ||
    trip.endBorough === boroughFilter
  );
}

function formatTripBorough(
  borough: Trip["startBorough"]
): string {
  if (borough === "other") {
    return "Other";
  }

  if (borough === "unknown") {
    return "Unknown";
  }

  return boroughMeta[borough].label;
}

function getTripPosition(
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

function App() {
  const [currentTime, setCurrentTime] = useState(8 * 60);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(SPEED_OPTIONS[1].value);
  const [rideFilter, setRideFilter] = useState<RideFilter>("all");
  const [boroughFilter, setBoroughFilter] = useState<BoroughFilter>("all");
  const [hoveredTrip, setHoveredTrip] = useState<Trip | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

  useEffect(() => {
    let ignore = false;

    async function run() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const result = await loadCitybikeSlice();
        if (ignore) {
          return;
        }

        setTrips(result.trips);
      } catch (error) {
        if (ignore) {
          return;
        }

        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load real Citi Bike data."
        );
        setIsPlaying(false);
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    void run();

    return () => {
      ignore = true;
    };
  }, []);

  const visibleTrips = trips.filter(
    (trip) =>
      matchesFilter(trip, rideFilter) &&
      matchesBoroughFilter(trip, boroughFilter)
  );
  const activeTrips = visibleTrips.filter(
    (trip) => currentTime >= trip.startTime && currentTime <= trip.endTime
  );
  const activeStations = uniqueStationCount(activeTrips);
  const highlightedTrip =
    hoveredTrip && visibleTrips.some((trip) => trip.id === hoveredTrip.id)
      ? hoveredTrip
      : activeTrips[0] ?? visibleTrips[0] ?? null;
  const renderedTrips =
    activeTrips.length > 32 ? activeTrips.slice(activeTrips.length - 32) : activeTrips;
  const focusStations = highlightedTrip
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

  useEffect(() => {
    setViewState(BOROUGH_VIEW_STATE[boroughFilter]);
  }, [boroughFilter]);

  useEffect(() => {
    if (!isPlaying || isLoading || loadError) {
      lastFrameRef.current = null;
      return;
    }

    let frameId = 0;

    const tick = (timestamp: number) => {
      if (lastFrameRef.current === null) {
        lastFrameRef.current = timestamp;
      }

      const deltaSeconds = (timestamp - lastFrameRef.current) / 1000;
      lastFrameRef.current = timestamp;

      setCurrentTime((previousTime) => {
        const nextTime = previousTime + deltaSeconds * speed;
        return nextTime >= totalSimulationSeconds
          ? nextTime % totalSimulationSeconds
          : nextTime;
      });

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isPlaying, isLoading, loadError, speed]);

  useEffect(() => {
    if (
      hoveredTrip &&
      !visibleTrips.some((trip) => trip.id === hoveredTrip.id)
    ) {
      setHoveredTrip(null);
    }
  }, [hoveredTrip, visibleTrips]);

  const layers = [
    new PathLayer<Trip>({
      id: "focus-route",
      data: highlightedTrip ? [highlightedTrip] : [],
      getPath: (trip) => trip.path,
      getColor: [28, 43, 68, 150],
      getWidth: 5,
      widthMinPixels: 1,
      rounded: true
    }),
    new TripsLayer<Trip>({
      id: "animated-trips",
      data: renderedTrips,
      getPath: (trip) => trip.path,
      getTimestamps: (trip) => trip.timestamps,
      getColor: (trip) => hexToRgb(trip.accent),
      getWidth: (trip) => (trip.bikeType === "electric_bike" ? 4.2 : 2.8),
      widthMinPixels: 2,
      rounded: true,
      trailLength: 4 * 60,
      currentTime,
      fadeTrail: true,
      capRounded: true,
      jointRounded: true,
      pickable: true,
      onHover: ({ object }: PickingInfo<Trip>) => {
        setHoveredTrip(object ?? null);
      }
    }),
    new ScatterplotLayer<Trip>({
      id: "bike-heads",
      data: renderedTrips,
      getPosition: (trip) => getTripPosition(trip, currentTime) ?? trip.path[0]!,
      radiusUnits: "meters",
      getRadius: (trip) => (trip.bikeType === "electric_bike" ? 52 : 42),
      getFillColor: (trip) => {
        const [red, green, blue] = hexToRgb(trip.accent);
        return [red, green, blue, 235];
      },
      getLineColor: [255, 255, 255, 210],
      lineWidthMinPixels: 1.5,
      stroked: true,
      pickable: true,
      onHover: ({ object }: PickingInfo<Trip>) => {
        setHoveredTrip(object ?? null);
      }
    }),
    new ScatterplotLayer({
      id: "focus-stations",
      data: focusStations,
      getPosition: (station) => station.coordinates,
      radiusUnits: "meters",
      getRadius: 95,
      getFillColor: [255, 209, 102, 220],
      getLineColor: [28, 43, 68, 220],
      lineWidthMinPixels: 2,
      stroked: true
    }),
    new TextLayer({
      id: "focus-station-labels",
      data: focusStations,
      getPosition: (station) => station.coordinates,
      getText: (station) => station.name,
      getColor: [20, 28, 38, 220],
      getSize: 14,
      sizeUnits: "pixels",
      fontFamily: "Space Grotesk, sans-serif",
      getTextAnchor: "start",
      getAlignmentBaseline: "bottom",
      getPixelOffset: [12, -10]
    })
  ];

  return (
    <div className="shell">
      <div className="backdrop" />
      <DeckGL
        controller
        layers={layers}
        onViewStateChange={(event) =>
          setViewState(event.viewState as typeof INITIAL_VIEW_STATE)
        }
        viewState={viewState}
        style={{ position: "absolute", top: "0", right: "0", bottom: "0", left: "0" }}
      >
        <Map
          mapLib={maplibregl}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
          reuseMaps
          style={{ width: "100%", height: "100%" }}
        />
      </DeckGL>

      <aside className="right-dock">
        <section className="panel hero-panel">
          <div className="eyebrow">Citi Bike morning playback</div>
          <h1>CityBike Flow</h1>
          <div className="summary-strip">
            <span>{formatSimulationDate(0)}</span>
            <span>
              {formatSimulationTime(0)}-{formatSimulationTime(totalSimulationSeconds)}
            </span>
            <span>{visibleTrips.length} rides loaded</span>
          </div>

          <div className="filter-label">Ride type</div>
          <div className="chip-row scroll-row">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option}
                className={option === rideFilter ? "chip active" : "chip"}
                onClick={() => setRideFilter(option)}
                type="button"
              >
                {rideFilterMeta[option].label}
              </button>
            ))}
          </div>

          <div className="filter-label">Borough</div>
          <div className="chip-row secondary scroll-row">
            {BOROUGH_OPTIONS.map((option) => (
              <button
                key={option}
                className={option === boroughFilter ? "chip active" : "chip"}
                onClick={() => setBoroughFilter(option)}
                type="button"
              >
                {boroughMeta[option].label}
              </button>
            ))}
          </div>

          {(isLoading || loadError) && (
            <p className="status-note">
              {isLoading ? "Loading the morning Citi Bike slice..." : loadError}
            </p>
          )}

          <div className="stats-grid">
            <article className="stat-card">
              <span>Active rides</span>
              <strong>{activeTrips.length}</strong>
            </article>
            <article className="stat-card">
              <span>Stations live</span>
              <strong>{activeStations}</strong>
            </article>
            <article className="stat-card">
              <span>Scene rides</span>
              <strong>{renderedTrips.length}</strong>
            </article>
          </div>
        </section>
        <section className="panel detail-panel">
          {highlightedTrip ? (
            <>
              <div className="detail-header">
                <span className="eyebrow">Active ride</span>
                <span className="detail-pill">
                  {highlightedTrip.bikeType === "electric_bike" ? "E-BIKE" : "CLASSIC"}
                </span>
              </div>
              <h2>{highlightedTrip.startStationName}</h2>
              <p className="detail-route">to {highlightedTrip.endStationName}</p>

              <dl className="detail-list">
                <div>
                  <dt>Distance</dt>
                  <dd>{formatMiles(highlightedTrip.routeDistance)}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{formatDuration(highlightedTrip.durationMinute)}</dd>
                </div>
                <div>
                  <dt>Departure</dt>
                  <dd>{formatSimulationTime(highlightedTrip.startTime)}</dd>
                </div>
                <div>
                  <dt>Rider</dt>
                  <dd>{highlightedTrip.riderLabel}</dd>
                </div>
              </dl>
              <p className="detail-boroughs">
                {formatTripBorough(highlightedTrip.startBorough)}
                {" -> "}
                {formatTripBorough(highlightedTrip.endBorough)}
              </p>
            </>
          ) : (
            <div className="detail-empty">
              {isLoading
                ? "Loading rides..."
                : loadError
                  ? "The data slice failed to load."
                : "No rides match the current filter."}
            </div>
          )}
          <div className="detail-controls">
            <div className="time-cluster">
              <div className="time-readout">
                <span>{formatSimulationDate(currentTime)}</span>
                <strong>{formatSimulationTime(currentTime)}</strong>
              </div>

              <input
                aria-label="Timeline"
                className="timeline"
                disabled={isLoading || Boolean(loadError)}
                max={totalSimulationSeconds}
                min={0}
                onChange={(event) => {
                  setCurrentTime(Number(event.target.value));
                  setIsPlaying(false);
                }}
                step={30}
                type="range"
                value={currentTime}
              />
            </div>

            <div className="control-row">
              <button
                className="control-button primary"
                disabled={isLoading || Boolean(loadError)}
                onClick={() => {
                  if (currentTime >= totalSimulationSeconds - 1) {
                    setCurrentTime(0);
                  }
                  setIsPlaying((value) => !value);
                }}
                type="button"
              >
                {isPlaying ? "Pause" : "Play"}
              </button>

              <button
                className="control-button"
                disabled={isLoading || Boolean(loadError)}
                onClick={() => {
                  setCurrentTime(0);
                  setIsPlaying(false);
                }}
                type="button"
              >
                Reset
              </button>

              <div className="speed-row compact">
                {SPEED_OPTIONS.map((option) => (
                  <button
                    key={option.label}
                    className={
                      option.value === speed ? "speed-chip active" : "speed-chip"
                    }
                    disabled={isLoading || Boolean(loadError)}
                    onClick={() => setSpeed(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

export default App;
