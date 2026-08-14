# Football Predictor V2.7

A minimal Vercel-ready production baseline focused on real upcoming football fixtures and bookmaker odds.

## Deploy
1. Upload the root files to GitHub.
2. In Vercel Project Settings → Environment Variables add:
   - `ODDS_API_KEY`
   - `API_FOOTBALL_KEY` (reserved for the next enrichment layer)
3. Redeploy.

The frontend is static. `/api/matches` is a Vercel serverless function and keeps `ODDS_API_KEY` server-side.

## Behaviour
- No fake fixtures.
- No fake odds.
- Empty API result remains empty.
- Odds are best available bookmaker prices for 1X2.
- Market probabilities are normalized bookmaker implied probabilities.
- Data is cached briefly at the edge to reduce API consumption.
