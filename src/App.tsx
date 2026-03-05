import { useEffect, useRef, useState } from "react";
import { DeckGL } from "@deck.gl/react";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type { PickingInfo } from "@deck.gl/core";
import Map from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import {
  loadCitybikeSlice,
  rideFilterMeta,
  totalSimulationSeconds,
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
  longitude: -73.985,
  latitude: 40.741,
  zoom: 12.35,
  pitch: 18,
  bearing: -8
};

const SPEED_OPTIONS = [
  { label: "20x", value: 20 },
  { label: "40x", value: 40 },
  { label: "80x", value: 80 }
] as const;

const SCENE_PRESETS = [
  { label: "Early rush", seconds: 10 * 60 },
  { label: "Bridge pulse", seconds: 38 * 60 },
  { label: "Late push", seconds: 66 * 60 }
] as const;

const FILTER_OPTIONS = Object.keys(rideFilterMeta) as RideFilter[];

function matchesFilter(trip: Trip, rideFilter: RideFilter) {
  return (
    rideFilter === "all" ||
    trip.bikeType === rideFilter ||
    trip.memberCasual === rideFilter
  );
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
  const [hoveredTrip, setHoveredTrip] = useState<Trip | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastFrameRef = useRef<number | null>(null);

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

  const visibleTrips = trips.filter((trip) => matchesFilter(trip, rideFilter));
  const activeTrips = visibleTrips.filter(
    (trip) => currentTime >= trip.startTime && currentTime <= trip.endTime
  );
  const activeStations = uniqueStationCount(activeTrips);
  const averageDistance =
    activeTrips.length > 0
      ? activeTrips.reduce((sum, trip) => sum + trip.routeDistance, 0) /
        activeTrips.length
      : 0;
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
        initialViewState={INITIAL_VIEW_STATE}
        layers={layers}
        style={{ position: "absolute", top: "0", right: "0", bottom: "0", left: "0" }}
      >
        <Map
          mapLib={maplibregl}
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
          reuseMaps
          style={{ width: "100%", height: "100%" }}
        />
      </DeckGL>

      <section className="panel hero-panel">
        <div className="eyebrow">Real Citi Bike playback</div>
        <h1>CityBike Flow</h1>
        <p className="lede">
          The prototype now pulls actual Citi Bike rides from the public{" "}
          <span>`cdn.bikemap.nyc`</span> parquet slice, then animates those
          routes locally with DuckDB WASM and deck.gl.
        </p>

        <div className="meta-row">
          <div>
            <span className="meta-label">Window</span>
            <strong>
              {formatSimulationDate(0)} · {formatSimulationTime(0)}-
              {formatSimulationTime(totalSimulationSeconds)}
            </strong>
          </div>
          <div>
            <span className="meta-label">Loaded rides</span>
            <strong>{trips.length}</strong>
          </div>
        </div>

        <div className="chip-row">
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

        <p className="description">{rideFilterMeta[rideFilter].description}</p>

        <p className="status-note">
          {isLoading
            ? "Loading the morning slice from the bikemap.nyc parquet CDN..."
            : loadError
              ? loadError
              : "Trips, stations, timestamps, bike type, and route geometry are real. This prototype reuses that public processed slice locally."}
        </p>

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
          <article className="stat-card">
            <span>Avg distance</span>
            <strong>{activeTrips.length ? formatMiles(averageDistance) : "0.0 mi"}</strong>
          </article>
        </div>

        <div className="preset-row">
          {SCENE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              className="preset"
              disabled={isLoading || Boolean(loadError)}
              onClick={() => {
                setCurrentTime(preset.seconds);
                setIsPlaying(false);
              }}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel detail-panel">
        {highlightedTrip ? (
          <>
            <div className="detail-header">
              <span className="eyebrow">Real ride focus</span>
              <span className="detail-pill">
                {highlightedTrip.bikeType === "electric_bike" ? "E-BIKE" : "CLASSIC"}
              </span>
            </div>
            <h2>{highlightedTrip.startStationName}</h2>
            <p>to {highlightedTrip.endStationName}</p>

            <dl className="detail-list">
              <div>
                <dt>Rider</dt>
                <dd>{highlightedTrip.riderLabel}</dd>
              </div>
              <div>
                <dt>Distance</dt>
                <dd>{formatMiles(highlightedTrip.routeDistance)}</dd>
              </div>
              <div>
                <dt>Departure</dt>
                <dd>{formatSimulationTime(highlightedTrip.startTime)}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(highlightedTrip.durationMinute)}</dd>
              </div>
            </dl>

            <div className="detail-footer">
              Route geometry comes from the processed `bikemap.nyc` public
              parquet slice, so the ride rows are real Citi Bike history even
              though this UI is a separate prototype.
            </div>
          </>
        ) : (
          <div className="detail-empty">
            {isLoading
              ? "Loading real Citi Bike routes..."
              : loadError
                ? "The data slice failed to load."
                : "No rides match the current filter."}
          </div>
        )}
      </section>

      <section className="panel controls-panel">
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

          <div className="speed-row">
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
      </section>
    </div>
  );
}

export default App;
