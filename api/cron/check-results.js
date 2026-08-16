import { redisGetJSON, redisSetJSON } from "../../lib/redis.js";

const BASE = "https://v3.football.api-sports.io";

async function apiFootball(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const r = await fetch(url, { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } });
  const text = await r.text();
  if (!r.ok) throw new Error(`API-Football ${path} failed: ${r.status} ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  if (data.errors && Object.keys(data.errors).length) throw new Error(JSON.stringify(data.errors));
  return data.response || [];
}

function actualOutcome(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return "home";
  if (homeGoals < awayGoals) return "away";
  return "draw";
}

export default async function handler(req, res) {
  const auth = req.headers["authorization"];
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!process.env.API_FOOTBALL_KEY) {
    return res.status(500).json({ ok: false, error: "API_FOOTBALL_KEY missing." });
  }

  try {
    const pending = (await redisGetJSON("history:pending")) || [];
    const stillPending = [];
    const checked = [];

    const now = Date.now();
    const READY_BUFFER_MS = 150 * 60 * 1000; // give the match 150 minutes to finish

    for (const p of pending) {
      const kickoff = new Date(p.commenceTime).getTime();
      if (!Number.isFinite(kickoff) || now - kickoff < READY_BUFFER_MS) {
        stillPending.push(p);
        continue;
      }

      try {
        const dateStr = new Date(p.commenceTime).toISOString().slice(0, 10);
        const fixtures = await apiFootball("/fixtures", { team: p.homeId, date: dateStr });
        const fixture = fixtures.find(f => f.teams?.away?.id === p.awayId || f.teams?.home?.id === p.homeId);

        if (!fixture || fixture.fixture?.status?.short !== "FT" || fixture.goals?.home === null) {
          stillPending.push(p); // not finished yet — try again next run
          continue;
        }

        const hg = fixture.goals.home, ag = fixture.goals.away;
        const outcome = actualOutcome(hg, ag);
        const outcomeLabel = outcome === "home" ? p.homeTeam : (outcome === "away" ? p.awayTeam : "Draw");

        const signCorrect = outcomeLabel === p.suggestedSign;
        const dcCorrect =
          (outcome === "home" && p.doubleChance?.homeOrDraw >= p.doubleChance?.awayOrDraw) ? true :
          (outcome === "draw") ? true :
          (outcome === "away" && p.doubleChance?.awayOrDraw >= p.doubleChance?.homeOrDraw) ? true : false;
        const actualBtts = hg > 0 && ag > 0;
        const bttsCorrect = (p.btts >= 0.5) === actualBtts;

        checked.push({ ...p, signCorrect, dcCorrect, bttsCorrect, finalScore: `${hg}-${ag}` });
      } catch {
        stillPending.push(p); // API hiccup — retry next run
      }
    }

    const stats = (await redisGetJSON("stats:summary")) || {
      totalChecked: 0, signCorrect: 0, dcCorrect: 0, bttsCorrect: 0, since: new Date().toISOString()
    };
    for (const c of checked) {
      stats.totalChecked++;
      if (c.signCorrect) stats.signCorrect++;
      if (c.dcCorrect) stats.dcCorrect++;
      if (c.bttsCorrect) stats.bttsCorrect++;
    }
    stats.lastUpdated = new Date().toISOString();

    await redisSetJSON("stats:summary", stats, 60 * 60 * 24 * 365);
    await redisSetJSON("history:pending", stillPending, 60 * 60 * 24 * 14);

    res.status(200).json({ ok: true, checkedNow: checked.length, stillPending: stillPending.length, stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
