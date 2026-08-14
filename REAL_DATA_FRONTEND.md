# V2.3 Real-Data Frontend

## What changed

The visual test environment has been promoted into the real React frontend.

### Live data path
The dashboard uses:

`The Odds API -> data-fetcher -> matches / oddsHistory -> tRPC -> React dashboard`

Predictions use:

`real match + real odds history + model engine -> predictions -> tRPC -> dashboard / Match Lab`

### No synthetic fixture fallback
The frontend does not contain hardcoded Arsenal/Chelsea/etc. fixtures. If the database has no upcoming real matches, it shows a clear waiting/error state.

### Match Lab
Route: `/match/:id`

Shows:
- real fixture and kickoff
- bookmaker count
- best available H/D/A odds from stored provider snapshots
- complete stored odds history
- latest model probabilities
- market probabilities
- expected value
- risk
- model factors

### Refreshing data
The authoritative automatic refresh is the server scheduler:
- initial ingestion at startup
- every 30 minutes thereafter
- MySQL distributed lock prevents duplicate cycles across instances

A protected admin procedure `matches.refreshLive` is also available for manual ingestion.

## Important
A real API key and database connection are required. This export deliberately does not include credentials. Without `ODDS_API_KEY` the system refuses synthetic production ingestion.
