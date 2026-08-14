# Live run guide

1. Put the real API credentials in `.env` (never in source code).
2. If a MySQL database is available, set `DATABASE_URL` to it and run migrations.
3. If no database is available, the app automatically falls back to live The Odds API data for upcoming fixtures and clearly labels predictions as market-fallback.
4. `ODDS_LEAGUES_PER_CYCLE=2` is the safe default for low-quota plans. The scheduler rotates through the configured leagues.
5. `LIVE_PREDICTION_LIMIT=12` limits transient predictions when running without persistent storage.
6. The application never generates fake fixtures or fake odds.

The full V2.3 team-form/H2H model requires persistent database-backed matches with API-Football team/league IDs. Live no-DB mode intentionally does not invent those IDs or pretend that form/H2H was used.
