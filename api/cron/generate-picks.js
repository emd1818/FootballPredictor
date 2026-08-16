import { fetchUpcomingMatches, bestPrice } from "../../lib/oddsApi.js";
import { predictMatch } from "../../lib/predictModel.js";
import { redisGetJSON, redisSetJSON } from "../../lib/redis.js";

// Size of the daily candidate pool. Only ~1 of these gets scored per
// invocation (see below), so an external scheduler pinging this endpoint
// every 10-15 minutes will work through the pool over the course of a day.
const POOL_LIMIT = 25;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export default async function handler(req, res) {
  const auth = req.headers["authorization"];
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!process.env.ODDS_API_KEY || !process.env.API_FOOTBALL_KEY) {
    return res.status(500).json({ ok: false, error: "ODDS_API_KEY or API_FOOTBALL_KEY missing." });
  }

  try {
    const today = todayKey();
    let queueState = await redisGetJSON("queue:state");

    // Start a fresh pool at the beginning of each day.
    if (!queueState || queueState.date !== today) {
      const { matches } = await fetchUpcomingMatches({ days: 2, regions: "eu", markets: "h2h" });
      const pool = matches.filter(m => m.bookmakersCount >= 2).slice(0, POOL_LIMIT);
      queueState = { date: today, remaining: pool, scored: [] };
      await redisSetJSON("queue:state", queueState, 60 * 60 * 30);
    }

    if (!queueState.remaining.length) {
      return res.status(200).json({
        ok: true,
        status: "pool exhausted for today",
        scoredToday: queueState.scored.length
      });
    }

    // Process exactly one match this invocation.
    const m = queueState.remaining.shift();
    let scoredMatch = null;
    let failure = null;

    try {
      const homeOdds = bestPrice(m, m.homeTeam);
      const drawOdds = bestPrice(m, "Draw");
      const awayOdds = bestPrice(m, m.awayTeam);
      const result = await predictMatch(m.homeTeam, m.awayTeam, { home: homeOdds, draw: drawOdds, away: awayOdds });

      if (result.sampleSize >= 2) {
        const maxProb = Math.max(result.model.home, result.model.draw, result.model.away);
        const signLabel = result.model.home === maxProb ? m.homeTeam : (result.model.away === maxProb ? m.awayTeam : "Draw");

        scoredMatch = {
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
        };
        queueState.scored.push(scoredMatch);

        // Queue for later results-checking (stats tracking).
        const pending = (await redisGetJSON("history:pending")) || [];
        pending.push({
          matchId: scoredMatch.matchId,
          homeTeam: scoredMatch.homeTeam,
          awayTeam: scoredMatch.awayTeam,
          commenceTime: scoredMatch.commenceTime,
          homeId: scoredMatch.homeId,
          awayId: scoredMatch.awayId,
          suggestedSign: scoredMatch.suggestedSign,
          doubleChance: scoredMatch.doubleChance,
          btts: scoredMatch.btts
        });
        await redisSetJSON("history:pending", pending, 60 * 60 * 24 * 14);
      }
    } catch (e) {
      failure = { match: `${m.homeTeam} vs ${m.awayTeam}`, error: e.message };
    }

    await redisSetJSON("queue:state", queueState, 60 * 60 * 30);

    // Publish the current top 10 from everything scored so far today.
    const top10 = [...queueState.scored].sort((a, b) => b.confidence - a.confidence).slice(0, 10);
    await redisSetJSON("picks:today", { generatedAt: new Date().toISOString(), picks: top10 }, 60 * 60 * 30);

    res.status(200).json({
      ok: true,
      scoredNow: scoredMatch ? `${scoredMatch.homeTeam} vs ${scoredMatch.awayTeam}` : null,
      failure,
      remainingInPool: queueState.remaining.length,
      scoredToday: queueState.scored.length
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
