# Football Odds Predictor — Technical Audit & Remediation

## Status

This export is the post-audit remediation baseline. The authoritative forecasting path is now `server/prediction-engine.ts` (Prediction Engine V2.1).

## Fixed

- Replaced the old odds-only confidence calculation with an independent probability model blended with a normalized market prior.
- Added a transparent Poisson goal model using recent team goals, defensive concession rates, explicit home advantage and a small H2H adjustment.
- Fixed bookmaker disagreement: it is now dispersion of normalized probabilities across bookmakers, not the spread between home/draw/away odds.
- Reworked odds movement and volatility using historical snapshots per bookmaker rather than averaging arbitrary movement fields.
- Fixed H2H orientation so historical home/away designation is translated to the current target home and away teams.
- Fixed API-Football recent-form acquisition to use `/fixtures?team=...&last=5&status=FT`; `/teams/statistics` remains an aggregate endpoint, not a last-five fixture feed.
- Added short-lived caching for team form, H2H and team-name resolution.
- Removed synthetic/sample data from production ingestion. Missing provider credentials or empty provider responses now fail/skip instead of fabricating football matches or odds.
- Made Odds API league selection configurable through `ODDS_LEAGUES`.
- Added best-available bookmaker odds and real expected value: `EV = modelProbability * decimalOdds - 1`.
- Prediction rows are immutable snapshots. The scheduler no longer deletes/replaces previous predictions.
- Added model and market probability columns, expected value, value flag and `asOf` timestamp.
- Added Brier score, log loss, probability and profit-unit evaluation fields.
- Replaced estimated ROI with actual unit-profit ROI based on stored odds.
- Added a historical replay evaluator through `analytics.backtest`.
- Replaced scheduler N+1 odds retrieval with a batched history query.
- Added a MySQL distributed scheduler lock and in-process overlap guard.
- Removed the duplicate daily prediction scheduler from startup; the 30-minute immutable pipeline is authoritative.
- Secured result recording behind `adminProcedure`.
- Secured notification preferences and notification mutations behind `protectedProcedure` and user-scoped database operations.
- Removed hard-coded user ID `1` from notification routes.
- Added database indexes for odds and prediction time-series access and unique constraints for notification preferences and prediction evaluation.
- Converted the former Enhanced Prediction Engine into a compatibility adapter around V2, eliminating two competing forecasting algorithms.

## Remaining external dependency / limitation

A true walk-forward ML backtest still requires a historical archive of fixtures, pre-match odds snapshots and historical feature snapshots. The current replay endpoint evaluates immutable predictions already stored by the application and explicitly reports that limitation; it does not pretend that current API data can be safely used to reconstruct the past.

The Manus OAuth/Forge adapters remain in the infrastructure layer. They are not part of the forecasting core and can be replaced later with another auth/LLM/storage provider without changing the model contract.


## V2.2 continuation remediation

- Corrected European football season calculation (January-June belongs to the previous season).
- Expanded The Odds API league mapping using current documented soccer sport keys.
- Added provider `sourceUpdatedAt` to odds history and idempotent snapshot ingestion.
- Fixed the single-league odds client to respect `ODDS_LEAGUES` instead of hardcoding EPL.
- Limited prediction-generation concurrency to five matches to avoid uncontrolled API/LLM fan-out.
- Scheduler now stores every generated prediction snapshot; ranking is applied only when serving the UI, avoiding selection bias in the evaluation dataset.
- Alert scanning is restricted to recently generated predictions and ordered by generation time.
- Corrected calibration error: it is now computed within confidence buckets rather than comparing mean confidence with overall accuracy.
- Added regression tests for football-season boundaries.

### Data architecture consequence
The system now preserves provider timestamps and immutable prediction snapshots, which is the minimum viable foundation for clean future walk-forward evaluation. The Odds API currently documents historical odds snapshots at 5-minute intervals for later periods and historical access on paid plans; this can be used for backfill when credentials/plan permit it.

## V2.3 development pass
- Added walk-forward probability calibration using only previously evaluated predictions.
- Stored calibration temperature/sample count with each prediction snapshot.
- Prediction `asOf` now tracks the latest provider odds timestamp rather than wall-clock generation time.
- Added paid historical Odds API snapshot ingestion, isolated from prediction generation.
- Added protected admin mutation for historical odds archiving.
- Added calibration unit tests.
