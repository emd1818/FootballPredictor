# Football Predictor V2.6.1 — Vercel-ready real-data frontend

This is a clean, self-contained Vite + React + Vercel serverless build. It has explicit `client/`, `server/`, `shared/`, and `api/` directories.

## Real data
- The Odds API: upcoming football fixtures and bookmaker H2H prices.
- API-Football: reserved for enrichment; the current live screen does not fabricate team statistics when enrichment is unavailable.

## Environment
Set `ODDS_API_KEY` in Vercel Project Settings → Environment Variables. `API_FOOTBALL_KEY` can also be set for the enrichment layer.

## Important
The live screen does not invent fixtures or odds. If the Odds API returns no events, the UI explicitly says so.

## Local
`npm install` then `npm run build`.
