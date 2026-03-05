# CityBike Prototype

Private prototype for a `bikemap.nyc`-style ride playback experience.

## Goals

- Build a local-first, no-backend prototype that animates a real Citi Bike historical slice on a map.
- Prove the interaction model: time scrubber, ride filters, hover details, and live route playback.
- Keep the stack lightweight enough to run locally with a single `npm install && npm run dev`.

## Stack

- Vite
- React + TypeScript
- deck.gl
- MapLibre GL
- DuckDB WASM

## Folder Map

- `src/`: application code, trip data, styles
- `docs/notes/`: lightweight project notes
- `docs/reference-notes/`: reusable reference material required for active repos

## Local Run

```bash
npm install
npm run dev
```

The app runs without a backend or API key.

## Notes

- The current slice uses real Citi Bike rides from `2025-07-18 07:00-08:35` America/New_York, loaded from the public `https://cdn.bikemap.nyc/parquets/2025-07-18.parquet`.
- Route geometry is inherited from the public processed `bikemap.nyc` parquet, not device GPS traces.
- Visual direction and playback model are inspired by `freeman-jiang/bikemap.nyc`.
