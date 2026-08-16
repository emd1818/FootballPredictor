import { fetchUpcomingMatches, bestPrice } from "../../lib/oddsApi.js";
import { predictMatch } from "../../lib/predictModel.js";
import { redisGetJSON, redisSetJSON } from "../../lib/redis.js";

// How many candidate matches to actually run the model on per day.
// Kept modest to respect the API-Football free-tier daily quota (100 req/day).
const CANDIDATE_LIMIT = 12;

export default async function handler(req, res) {
  // Protect the endpoint: only Vercel Cron (or someone with the secret) can trigger it.
  const auth = req.headers["authorization"];
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (!process.env.ODDS_API_KEY || !process.env.API_FOOTBALL_KEY) {
    return res.status(500).json({ ok: false, error: "ODDS_API_KEY or API_FOOTBALL_KEY missing." });
  }

  try {
    const { matches } = await fetchUpcomingMatches({ days: 2, regions: "eu", markets: "h2h" });
    const candidates = matches
      .filter(m => m.bookmakersCount >= 2) // skip matches with too little bookmaker coverage
      .slice(0, CANDIDATE_LIMIT);

    const picks = [];
    const failures = [];

    for (const m of candidates) {
      const homeOdds = bestPrice(m, m.homeTeam);
      const drawOdds = bestPrice(m, "Draw");
      const awayOdds = bestPrice(m, m.awayTeam);

      try {
        const result = await predictMatch(m.homeTeam, m.awayTeam, { home: homeOdds, draw: drawOdds, away: awayOdds });
        if (result.sampleSize < 2) continue; // too little real data to trust

        const signLabel = result.model.home === Math.max(result.model.home, result.model.draw, result.model.away)
          ? m.homeTeam
          : (result.model.away === Math.max(result.model.home, result.model.draw, result.model.away) ? m.awayTeam : "Draw");

        picks.push({
          matchId: m.id,
          league: m.league,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          commenceTime: m.commenceTime,
          model: result.model,
          confidence: result.confidence,
          suggestedSign: signLabel,
          doubleChance: result.doubleChance,
          btts: result.btts,
          market: result.market,
          value: result.value,
          homeId: result.homeId,
          awayId: result.awayId
        });
      } catch (e) {
        failures.push({ match: `${m.homeTeam} vs ${m.awayTeam}`, error: e.message });
      }
    }

    picks.sort((a, b) => b.confidence - a.confidence);
    const top10 = picks.slice(0, 10);

    await redisSetJSON("picks:today", {
      generatedAt: new Date().toISOString(),
      picks: top10
    }, 60 * 60 * 30); // expires after 30h as a safety net

    // Queue these for later results-checking (used by the stats cron)
    const pending = (await redisGetJSON("history:pending")) || [];
    const newPending = top10.map(p => ({
      matchId: p.matchId,
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
      commenceTime: p.commenceTime,
      homeId: p.homeId,
      awayId: p.awayId,
      suggestedSign: p.suggestedSign,
      doubleChance: p.doubleChance,
      btts: p.btts
    }));
    await redisSetJSON("history:pending", [...pending, ...newPending], 60 * 60 * 24 * 14);

    res.status(200).json({ ok: true, generated: top10.length, candidatesScanned: candidates.length, failures });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
