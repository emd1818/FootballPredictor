# Football Odds Predictor

A production-ready full-stack web application that automatically analyzes football odds movement from multiple sources, runs AI-powered predictions with confidence scoring, tracks team form and head-to-head statistics, and features an automated 30-minute scheduler.

---

## Key Features

1. **Real-Time Odds Tracking**: Live odds integration from The Odds API across multiple leagues and bookmakers.
2. **AI-Powered Prediction Engine**: Multi-factor confidence scoring (0-100%), risk assessment, odds movement analysis, and automated natural-language reasoning.
3. **Team Statistics & Form Analysis**: Integration with API-Football for team form scoring (0-100), head-to-head advantage tracking (-100 to +100), recent match W/D/L badges, and form trend sparklines.
4. **Automated Background Scheduler**: Cron-based worker running every 30 minutes to update odds and regenerate predictions.
5. **Accuracy Tracking Dashboard**: Comprehensive performance analytics tracking win rates by confidence tier, league breakdown, and ROI simulation.
6. **User Alert System**: Configurable alert preferences for high-confidence predictions.

---

## Tech Stack

- **Frontend**: React 19, Tailwind CSS 4, shadcn/ui components, Wouter routing, tRPC client.
- **Backend**: Node.js, Express, tRPC 11 server, Drizzle ORM.
- **Database**: MySQL / TiDB.
- **Testing**: Vitest specification suite.

---

## Getting Started & Installation

### Prerequisites
- Node.js (v18+)
- pnpm package manager
- MySQL or TiDB database instance

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment Variables
Copy the provided environment template and fill in your credentials:
```bash
cp .env.example .env
```
Ensure you provide:
- `DATABASE_URL`: Your MySQL connection string.
- `ODDS_API_KEY`: Your key from [The Odds API](https://the-odds-api.com).
- `API_FOOTBALL_KEY`: Your key from [API-Football](https://www.api-football.com).
- `JWT_SECRET`: A secure secret string for session cookies.

### 3. Push Database Schema
```bash
pnpm db:push
```

### 4. Run Development Server
```bash
pnpm dev
```
The application will be available at `http://localhost:3000`.

---

## Testing

Run the test suite using Vitest:
```bash
pnpm test
```

---

## Deployment

Build the application for production:
```bash
pnpm build
pnpm start
```


## Current model status

Version 2.2 uses an independent Poisson-based team model blended with normalized market probabilities. Bookmaker odds are treated as a prior and source of market price/value, not as the prediction itself. Prediction snapshots are immutable, all successfully generated matches are stored for evaluation, and provider timestamps make odds ingestion idempotent.

A genuine walk-forward backtest is not claimed until a historical feature/odds archive is available. The Odds API documents historical odds snapshots and historical events on eligible plans, so that archive can be populated separately when credentials permit.

## Real API setup

The application is configured to use real upcoming football data. Set `ODDS_API_KEY` and `API_FOOTBALL_KEY` in a local `.env` file (never commit or upload it).

Run `pnpm verify:apis` to verify both credentials before starting the app.

The frontend intentionally shows no synthetic fixtures when the real ingestion pipeline has no data.

## Live-data mode without a database
If DATABASE_URL is unavailable, the frontend now falls back to The Odds API for real upcoming fixtures and a clearly labelled market-fallback prediction layer. No synthetic fixtures are generated. When a real database is available, V2.3 team-form/H2H modelling and immutable prediction history remain authoritative.

### API quota controls
- `ODDS_LEAGUES_PER_CYCLE=2` limits the number of league requests per 30-minute scheduler cycle.
- `LIVE_PREDICTION_LIMIT=12` limits transient live predictions.
- Increase these only if your provider plan supports the additional request volume.
