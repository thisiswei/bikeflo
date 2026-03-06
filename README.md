# bikeflo

Public prototype for exploring historical Citi Bike playback in New York.

## Goals

- Build a local-first, no-backend prototype that animates a real Citi Bike historical slice on a map.
- Prove the interaction model: time scrubber, ride filters, click-to-inspect details, and live route playback.
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

## Deploy

GitHub Pages is configured to deploy from `main` via Actions.

- Target URL: `https://thisiswei.github.io/bikeflo`
- Workflow: [deploy-pages.yml](/Users/w/Development/code/bikeflo/.github/workflows/deploy-pages.yml)

## Notes

- The current slice uses real Citi Bike rides from `2025-07-18 06:00-10:30` America/New_York, loaded from the public `https://cdn.bikemap.nyc/parquets/2025-07-18.parquet`.
- Route geometry comes from the public processed parquet, not device GPS traces.
- The browser currently loads a balanced morning sample and animates only the active ride set for readability.
