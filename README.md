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
- Static preprocessed trip slice

## Folder Map

- `public/data/`: preprocessed official Citi Bike slice shipped with the app
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

GitHub Pages is configured to deploy from `master` via Actions.

- Target URL: `https://thisiswei.github.io/bikeflo`
- Workflow: [deploy-pages.yml](/Users/w/Development/code/bikeflo/.github/workflows/deploy-pages.yml)

## Notes

- The current slice uses real Citi Bike rides from the official February 2026 trip history for `2026-02-27 06:00-10:30` America/New_York.
- The browser loads a preprocessed local slice from `public/data/official-2026-02-27-morning.json`, so the deployed app does not fetch raw AWS trip ZIPs at runtime.
- Route paths are inferred approximations from start and end stations, not device GPS traces.
