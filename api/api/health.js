export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "football-predictor",
    version: "2.7.0",
    timestamp: new Date().toISOString(),
    providers: {
      oddsApi: Boolean(process.env.ODDS_API_KEY),
      apiFootball: Boolean(process.env.API_FOOTBALL_KEY)
    }
  });
}
