import { useEffect, useRef, useState } from "react";
import { DeckGL } from "@deck.gl/react";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type { PickingInfo } from "@deck.gl/core";
import Map from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import {
  boroughMeta,
  initialSimulationSeconds,
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
  const [currentTime, setCurrentTime] = useState(initialSimulationSeconds);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(SPEED_OPTIONS[1].value);
  const [rideFilter, setRideFilter] = useState<RideFilter>("all");
  const [boroughFilter, setBoroughFilter] = useState<BoroughFilter>("all");
  const [hoveredTrip, setHoveredTrip] = useState<Trip | null>(null);
  const [pinnedTripId, setPinnedTripId] = useState<string | null>(null);
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
  const labeledFocusStations = hasExplicitFocus ? focusStations : [];

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

  useEffect(() => {
    if (
      pinnedTripId &&
      !visibleTrips.some((trip) => trip.id === pinnedTripId)
    ) {
      setPinnedTripId(null);
    }
  }, [pinnedTripId, visibleTrips]);

  const handleTripHover = ({ object }: PickingInfo<Trip>) => {
    setHoveredTrip(object ?? null);
  };

  const handleTripPin = ({ object }: PickingInfo<Trip>) => {
    setPinnedTripId(object?.id ?? null);
  };

  const layers = [
    new PathLayer<Trip>({
      id: "focus-route",
      data: highlightedTrip ? [highlightedTrip] : [],
      getPath: (trip) => trip.path,
      getColor: [28, 43, 68, 110],
      getWidth: 3.5,
      widthMinPixels: 0.75,
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
      onHover: handleTripHover,
      onClick: handleTripPin
    }),
    new ScatterplotLayer<Trip>({
      id: "hover-targets",
      data: renderedTrips,
      getPosition: (trip) => getTripPosition(trip, currentTime) ?? trip.path[0]!,
      radiusUnits: "pixels",
      getRadius: 14,
      getFillColor: [0, 0, 0, 0],
      stroked: false,
      pickable: true,
      onHover: handleTripHover,
      onClick: handleTripPin
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
      pickable: false
    }),
    new ScatterplotLayer({
      id: "focus-stations",
      data: focusStations,
      getPosition: (station) => station.coordinates,
      radiusUnits: "meters",
      getRadius: 54,
      getFillColor: [255, 209, 102, 92],
      getLineColor: [28, 43, 68, 168],
      lineWidthMinPixels: 1.25,
      stroked: true
    }),
    new TextLayer({
      id: "focus-station-labels",
      data: labeledFocusStations,
      getPosition: (station) => station.coordinates,
      getText: (station) => station.name,
      getColor: [44, 56, 70, 182],
      getSize: 12,
      sizeUnits: "pixels",
      fontFamily: "Space Grotesk, sans-serif",
      getTextAnchor: "start",
      getAlignmentBaseline: "bottom",
      getPixelOffset: [10, -8]
    })
  ];

  return (
    <div className="shell">
      <div className="backdrop" />
      <DeckGL
        controller
        layers={layers}
        pickingRadius={8}
        onClick={(event) => {
          if (!event.object) {
            setPinnedTripId(null);
          }
        }}
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
          <h1>bikeflo</h1>
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
          {pinnedTrip ? (
            <>
              <div className="detail-header">
                <span className="eyebrow">Pinned ride details</span>
                <span className="detail-pill">
                  {pinnedTrip.bikeType === "electric_bike" ? "E-BIKE" : "CLASSIC"}
                </span>
              </div>
              <h2>{pinnedTrip.startStationName}</h2>
              <p className="detail-route">to {pinnedTrip.endStationName}</p>

              <dl className="detail-list">
                <div>
                  <dt>Start station</dt>
                  <dd>{pinnedTrip.startStationName}</dd>
                </div>
                <div>
                  <dt>End station</dt>
                  <dd>{pinnedTrip.endStationName}</dd>
                </div>
                <div>
                  <dt>Start time</dt>
                  <dd>{formatSimulationTime(pinnedTrip.startTime)}</dd>
                </div>
                <div>
                  <dt>End time</dt>
                  <dd>{formatSimulationTime(pinnedTrip.endTime)}</dd>
                </div>
                <div>
                  <dt>Bike type</dt>
                  <dd>
                    {pinnedTrip.bikeType === "electric_bike"
                      ? "Electric bike"
                      : "Classic bike"}
                  </dd>
                </div>
                <div>
                  <dt>Rider</dt>
                  <dd>{pinnedTrip.riderLabel}</dd>
                </div>
                <div>
                  <dt>Distance</dt>
                  <dd>{formatMiles(pinnedTrip.routeDistance)}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{formatDuration(pinnedTrip.durationMinute)}</dd>
                </div>
              </dl>
              <p className="detail-boroughs">
                {formatTripBorough(pinnedTrip.startBorough)}
                {" -> "}
                {formatTripBorough(pinnedTrip.endBorough)}
              </p>
              <button
                className="detail-clear"
                onClick={() => setPinnedTripId(null)}
                type="button"
              >
                Clear selection
              </button>
            </>
          ) : (
            <div className="detail-empty">
              {isLoading
                ? "Loading rides..."
                : loadError
                  ? "The data slice failed to load."
                  : hoveredVisibleTrip
                    ? "Click this ride to pin it and inspect full trip details."
                    : "Click a moving ride to inspect its full trip details."}
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
