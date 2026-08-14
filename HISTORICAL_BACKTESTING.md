# Historical dataset and walk-forward calibration

The project now separates three concerns:

1. **Live ingestion** — current odds are collected every 30 minutes.
2. **Historical archive** — paid historical Odds API snapshots can be imported without generating predictions.
3. **Walk-forward calibration** — once at least 100 evaluated predictions exist, a temperature scaler is fitted only on observations evaluated before the prediction's `asOf` time. No future results are used.

## Historical odds archive

Use the protected `prediction.archiveHistoricalOdds` mutation with a sport key and ISO timestamp. The Odds API historical endpoint returns the closest snapshot at or before the requested timestamp. Historical access requires a paid plan.

The archive is intentionally separate from the live prediction pipeline. Imported historical snapshots are never turned into predictions automatically.

## What is and is not a full backtest

The current `backtest` endpoint is an evaluation/replay report over immutable prediction snapshots already produced by the system. The new archive endpoint supplies the raw odds history needed for a true historical replay.

A leakage-free full model replay additionally requires historical team-form feature snapshots as they existed at each prediction timestamp. The system therefore does not claim that archived odds alone constitute a full historical re-run of the current team model.

## Historical results

The protected `prediction.syncHistoricalResults` mutation imports completed API-Football fixtures for a date/league/season, matches them to archived events using stable team IDs plus kickoff tolerance, and evaluates every immutable prediction snapshot for the matched event. API-Football documents `fixtures` with `date`, `league`, `season`, and completed statuses such as `FT-AET-PEN`.
